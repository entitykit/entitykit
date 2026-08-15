import { join } from 'node:path';
import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import {
    ContextStateRestorationError,
    DbContext,
    DbUpdateConcurrencyError,
    EntityState,
} from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';
import { createManagedTempDirectory } from './support/managed-temp-directory';
import { requireDefined } from './support/require-defined';

class AtomicDocument {
    public id = '';
    public title = '';
    public version = 1;
}

let databaseFile = '';
class AtomicConcurrencyContext extends DbContext {
    public documents = this.set(AtomicDocument);
    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, databaseFile);
    }
    protected override model(model: ModelBuilder): void {
        model.entity(AtomicDocument, entity => {
            entity.toTable('atomic_documents');
            entity.hasKey(value => value.id);
            entity.property(value => value.id)
                .hasColumnType('text').isRequired();
            entity.property(value => value.title)
                .hasColumnType('text').isRequired();
            entity.property(value => value.version)
                .hasColumnType('integer').isRequired().isVersion();
        });
    }
}

describe('concurrency failure atomicity', () => {
    beforeEach(async () => {
        databaseFile = join(
            createManagedTempDirectory('ek-atomic-recovery-'), 'recovery.db',
        );
        const db = AtomicConcurrencyContext.create();
        await db.database.connection.query({
            text: db.database.createScript(), values: [],
        });
        db.documents.add(Object.assign(new AtomicDocument(), {
            id: 'doc_1', title: 'original', version: 1,
        }));
        await db.saveChanges();
        await db.dispose();
    });

    it('restores reload after a mutating setter throws a primitive', async () => {
        const { writer, reader, written, read } = await openPair();
        written.title = 'database';
        await writer.saveChanges();
        const primary = Symbol('reload setter failed');
        installMutatingFailure(read, 'title', 'database', primary);
        const entry = requireDefined(reader.entry(read));

        expect(await rejection(async () => entry.reload())).toBe(primary);
        expect(read).toMatchObject({ title: 'original', version: 1 });
        expect(entry.originalValues).toMatchObject({
            title: 'original', version: 1,
        });
        expect(entry.state).toBe(EntityState.Unchanged);
        await expect(reader.documents.count()).resolves.toBe(1);
        await writer.dispose();
        await reader.dispose();
    });

    it('restores client-wins baselines after a mutating version failure', async () => {
        const { writer, reader: loser, written, read: losing } = await openPair();
        written.title = 'server';
        losing.title = 'client';
        await writer.saveChanges();
        await captureConflict(loser);
        const entry = requireDefined(loser.entry(losing));
        const values = requireDefined(await entry.getDatabaseValues());
        const primary = 'version setter failed';
        installMutatingFailure(losing, 'version', 2, primary);

        expect(await rejection(async () =>
            entry.resolveConcurrency('clientWins', values))).toBe(primary);
        expect(losing).toMatchObject({ title: 'client', version: 1 });
        expect(entry.originalValues).toMatchObject({
            title: 'original', version: 1,
        });
        expect(entry.state).toBe(EntityState.Modified);
        await expect(loser.documents.count()).resolves.toBe(1);
        await writer.dispose();
        await loser.dispose();
    });

    it('poisons reload when a restoration setter throws', async () => {
        const { writer, reader, written, read } = await openPair();
        written.title = 'database';
        await writer.saveChanges();
        const primary = new Error('reload setter failed');
        installMutatingFailure(read, 'title', 'database', primary, {
            restorationFailure: new Error('reload restoration failed'),
        });
        const entry = requireDefined(reader.entry(read));

        expect(await rejection(async () => entry.reload())).toBe(primary);
        expect(await rejection(async () => reader.documents.count()))
            .toBeInstanceOf(ContextStateRestorationError);
        await writer.dispose();
        await reader.dispose();
    });

    it('rejects supplied values immediately after restoration poisoning', async () => {
        const { writer, reader: loser, written, read: losing } = await openPair();
        written.title = 'database';
        losing.title = 'client';
        await writer.saveChanges();
        await captureConflict(loser);
        const entry = requireDefined(loser.entry(losing));
        const values = requireDefined(await entry.getDatabaseValues());
        const primary = 'database wins failed';
        installMutatingFailure(losing, 'title', 'database', primary, {
            refuseRestoration: true,
        });

        expect(await rejection(async () =>
            entry.resolveConcurrency('databaseWins', values))).toBe(primary);
        const unusable = await rejection(async () => loser.documents.count());
        expect(unusable).toBeInstanceOf(ContextStateRestorationError);
        expect(await rejection(async () =>
            entry.resolveConcurrency('databaseWins', values))).toBe(unusable);
        await writer.dispose();
        await loser.dispose();
    });
});

async function openPair(): Promise<{
    writer: AtomicConcurrencyContext;
    reader: AtomicConcurrencyContext;
    written: AtomicDocument;
    read: AtomicDocument;
}> {
    const writer = AtomicConcurrencyContext.create();
    const reader = AtomicConcurrencyContext.create();
    return {
        writer, reader,
        written: requireDefined(await writer.documents.find('doc_1')),
        read: requireDefined(await reader.documents.find('doc_1')),
    };
}

function installMutatingFailure<TEntity extends object, TKey extends keyof TEntity>(
    entity: TEntity,
    property: TKey,
    failingValue: TEntity[TKey],
    primary: unknown,
    restoration?: {
        readonly restorationFailure?: unknown;
        readonly refuseRestoration?: boolean;
    },
): void {
    let stored = entity[property];
    const previous = stored;
    Object.defineProperty(entity, property, {
        configurable: true, enumerable: true, get: () => stored,
        set: (value: TEntity[TKey]) => {
            if (Object.is(value, previous) && !Object.is(stored, previous)) {
                if (restoration?.refuseRestoration) return;
                stored = value;
                if (restoration?.restorationFailure !== undefined) {
                    // Deliberately exercise an exact primitive cleanup failure.
                    // eslint-disable-next-line @typescript-eslint/only-throw-error
                    throw restoration.restorationFailure;
                }
                return;
            }
            stored = value;
            if (Object.is(value, failingValue)) throw primary;
        },
    });
}

async function rejection(action: () => unknown): Promise<unknown> {
    try {
        await action();
    } catch (error) {
        return error;
    }
    throw new Error('Expected operation to reject.');
}

async function captureConflict(context: AtomicConcurrencyContext): Promise<void> {
    try {
        await context.saveChanges();
    } catch (error) {
        if (error instanceof DbUpdateConcurrencyError) return;
        throw error;
    }
    throw new Error('Expected saveChanges() to report a concurrency conflict.');
}
