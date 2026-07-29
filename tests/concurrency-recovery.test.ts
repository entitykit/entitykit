import { join } from 'node:path';
import type {
    DbContextOptionsBuilder,
    EntityDatabaseValues,
    ModelBuilder,
} from '../src';
import {
    DbContext,
    DbUpdateConcurrencyError,
    EntityState,
} from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';
import { requireDefined } from './support/require-defined';
import { createManagedTempDirectory } from './support/managed-temp-directory';

class Document {
    public id!: string;
    public title!: string;
    public version!: number;

    constructor(data?: Partial<Document>) {
        Object.assign(this, data);
    }
}

let databaseFile = '';

class RecoveryContext extends DbContext {
    public documents = this.set(Document);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, databaseFile);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Document, entity => {
            entity.toTable('documents');
            entity.hasKey(document => document.id);
            entity.property(document => document.id)
                .hasColumnType('text').isRequired();
            entity.property(document => document.title)
                .hasColumnType('text').isRequired();
            entity.property(document => document.version)
                .hasColumnType('integer').isRequired().isVersion();
        });
    }
}

describe('optimistic concurrency recovery', () => {
    let directory = '';

    beforeEach(async () => {
        directory = createManagedTempDirectory('ek-recovery-');
        databaseFile = join(directory, 'recovery.db');
        const db = RecoveryContext.create();
        await db.database.connection.query({
            text: 'create table documents (id text primary key, title text not null, version integer not null)',
            values: [],
        });
        db.documents.add(new Document({
            id: 'doc_1',
            title: 'original',
            version: 1,
        }));
        await db.saveChanges();
        await db.dispose();
    });

    it('exposes the conflicting entry and immutable database values', async () => {
        const winner = RecoveryContext.create();
        const loser = RecoveryContext.create();
        const winnerDocument = requireDefined(
            await winner.documents.find('doc_1'),
        );
        const loserDocument = requireDefined(
            await loser.documents.find('doc_1'),
        );
        winnerDocument.title = 'winner';
        loserDocument.title = 'loser';
        await winner.saveChanges();

        const error = await captureConflict(loser);
        const entry = requireDefined(loser.entry(loserDocument));
        expect(error.entry).toBe(entry);
        expect(error.entries).toEqual([entry]);

        const values: EntityDatabaseValues<Document> = requireDefined(
            await entry.getDatabaseValues(),
        );
        const title: string = values.get('title');
        const version: number = values.get('version');
        expect({ title, version }).toEqual({ title: 'winner', version: 2 });
        expect(values.propertyNames).toEqual(['id', 'title', 'version']);
        expect(Object.isFrozen(values.toObject())).toBe(true);
        expect(loserDocument).toMatchObject({ title: 'loser', version: 1 });
        expect(entry.state).toBe(EntityState.Modified);

        await winner.dispose();
        await loser.dispose();
    });

    it('supports an inspected merge and client-wins retry', async () => {
        const winner = RecoveryContext.create();
        const loser = RecoveryContext.create();
        const winnerDocument = requireDefined(
            await winner.documents.find('doc_1'),
        );
        const loserDocument = requireDefined(
            await loser.documents.find('doc_1'),
        );
        winnerDocument.title = 'server edit';
        loserDocument.title = 'client edit';
        await winner.saveChanges();
        await captureConflict(loser);

        const entry = requireDefined(loser.entry(loserDocument));
        const databaseValues = requireDefined(
            await entry.getDatabaseValues(),
        );
        loserDocument.title =
            `${loserDocument.title} over ${databaseValues.get('title')}`;
        await entry.resolveConcurrency('clientWins', databaseValues);

        expect(loserDocument).toMatchObject({
            title: 'client edit over server edit',
            version: 2,
        });
        expect(entry.originalValues).toMatchObject({
            title: 'server edit',
            version: 2,
        });
        expect(entry.state).toBe(EntityState.Modified);
        await loser.saveChanges();

        const check = RecoveryContext.create();
        expect(await check.documents.find('doc_1')).toMatchObject({
            title: 'client edit over server edit',
            version: 3,
        });
        await check.dispose();
        await winner.dispose();
        await loser.dispose();
    });

    it('supports database-wins recovery without a second save', async () => {
        const winner = RecoveryContext.create();
        const loser = RecoveryContext.create();
        const winnerDocument = requireDefined(
            await winner.documents.find('doc_1'),
        );
        const loserDocument = requireDefined(
            await loser.documents.find('doc_1'),
        );
        winnerDocument.title = 'server edit';
        loserDocument.title = 'discard me';
        await winner.saveChanges();
        await captureConflict(loser);

        const entry = requireDefined(loser.entry(loserDocument));
        const values = await entry.resolveConcurrency('databaseWins');
        expect(values?.get('title')).toBe('server edit');
        expect(loserDocument).toMatchObject({
            title: 'server edit',
            version: 2,
        });
        expect(entry.state).toBe(EntityState.Unchanged);
        await expect(loser.saveChanges()).resolves.toBe(0);

        await winner.dispose();
        await loser.dispose();
    });

    it('reloads any persisted entry and discards local changes', async () => {
        const writer = RecoveryContext.create();
        const reader = RecoveryContext.create();
        const written = requireDefined(await writer.documents.find('doc_1'));
        const read = requireDefined(await reader.documents.find('doc_1'));
        written.title = 'database';
        await writer.saveChanges();
        read.title = 'local';

        const entry = requireDefined(reader.entry(read));
        await expect(entry.reload()).resolves.toBe(true);
        expect(read).toMatchObject({ title: 'database', version: 2 });
        expect(entry.state).toBe(EntityState.Unchanged);

        await writer.dispose();
        await reader.dispose();
    });

    it('reload returns false and detaches when the row is gone', async () => {
        const deleter = RecoveryContext.create();
        const reader = RecoveryContext.create();
        deleter.documents.remove(requireDefined(
            await deleter.documents.find('doc_1'),
        ));
        const document = requireDefined(
            await reader.documents.find('doc_1'),
        );
        await deleter.saveChanges();

        const entry = requireDefined(reader.entry(document));
        await expect(entry.reload()).resolves.toBe(false);
        expect(entry.state).toBe(EntityState.Detached);
        expect(reader.entry(document)).toBeUndefined();

        await deleter.dispose();
        await reader.dispose();
    });

    it('detaches database-wins entries whose row was deleted', async () => {
        const deleter = RecoveryContext.create();
        const loser = RecoveryContext.create();
        deleter.documents.remove(requireDefined(
            await deleter.documents.find('doc_1'),
        ));
        const loserDocument = requireDefined(
            await loser.documents.find('doc_1'),
        );
        await deleter.saveChanges();
        loserDocument.title = 'cannot survive';
        await captureConflict(loser);

        const entry = requireDefined(loser.entry(loserDocument));
        await expect(
            entry.resolveConcurrency('databaseWins'),
        ).resolves.toBeNull();
        expect(entry.state).toBe(EntityState.Detached);
        expect(loser.entry(loserDocument)).toBeUndefined();

        await deleter.dispose();
        await loser.dispose();
    });

    it('rejects client-wins when the database row was deleted', async () => {
        const deleter = RecoveryContext.create();
        const loser = RecoveryContext.create();
        deleter.documents.remove(requireDefined(
            await deleter.documents.find('doc_1'),
        ));
        const loserDocument = requireDefined(
            await loser.documents.find('doc_1'),
        );
        await deleter.saveChanges();
        loserDocument.title = 'cannot retry';
        await captureConflict(loser);

        const entry = requireDefined(loser.entry(loserDocument));
        await expect(entry.resolveConcurrency('clientWins')).rejects.toThrow(
            'database row no longer exists',
        );
        expect(entry.state).toBe(EntityState.Modified);

        await deleter.dispose();
        await loser.dispose();
    });

    it('refreshes a stale delete baseline before retrying it', async () => {
        const winner = RecoveryContext.create();
        const loser = RecoveryContext.create();
        const winnerDocument = requireDefined(
            await winner.documents.find('doc_1'),
        );
        const loserDocument = requireDefined(
            await loser.documents.find('doc_1'),
        );
        winnerDocument.title = 'updated before delete';
        loser.documents.remove(loserDocument);
        await winner.saveChanges();
        await captureConflict(loser);

        const entry = requireDefined(loser.entry(loserDocument));
        await entry.resolveConcurrency('clientWins');
        expect(entry.state).toBe(EntityState.Deleted);
        expect(loserDocument.version).toBe(2);
        await expect(loser.saveChanges()).resolves.toBe(1);

        const check = RecoveryContext.create();
        expect(await check.documents.find('doc_1')).toBeNull();
        await check.dispose();
        await winner.dispose();
        await loser.dispose();
    });

    it('rejects a database snapshot loaded for another entry', async () => {
        const seed = RecoveryContext.create();
        seed.documents.add(new Document({
            id: 'doc_2',
            title: 'second',
            version: 1,
        }));
        await seed.saveChanges();
        await seed.dispose();

        const winner = RecoveryContext.create();
        const loser = RecoveryContext.create();
        const winnerDocument = requireDefined(
            await winner.documents.find('doc_1'),
        );
        const loserDocument = requireDefined(
            await loser.documents.find('doc_1'),
        );
        const other = requireDefined(await loser.documents.find('doc_2'));
        winnerDocument.title = 'winner';
        loserDocument.title = 'loser';
        await winner.saveChanges();
        await captureConflict(loser);

        const entry = requireDefined(loser.entry(loserDocument));
        const otherValues = requireDefined(
            await requireDefined(loser.entry(other)).getDatabaseValues(),
        );
        await expect(
            entry.resolveConcurrency('clientWins', otherValues as never),
        ).rejects.toThrow('same tracked entry');

        await winner.dispose();
        await loser.dispose();
    });
});

async function captureConflict(
    context: RecoveryContext,
): Promise<DbUpdateConcurrencyError> {
    try {
        await context.saveChanges();
    } catch (error) {
        if (error instanceof DbUpdateConcurrencyError) {
            return error;
        }
        throw error;
    }
    throw new Error('Expected saveChanges() to report a concurrency conflict.');
}
