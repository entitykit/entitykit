import type {
    DbContextOptionsBuilder,
    ModelBuilder,
    ValueConverter,
} from '../src';
import { DbContext, EntityState } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';
import { requireDefined } from './support/require-defined';

class Revision {
    public version?: number | null;
}

class ComplexConcurrencyDocument {
    public id = '';
    public title = '';
    public revision?: Revision | null;
    public otherVersion = 1;
}

let converterFailure: unknown;
const versionConverter: ValueConverter<number, number> = {
    toProvider: value => {
        if (value === 2 && converterFailure !== undefined) {
            // Deliberately prove that primitive converter failures survive.
            // eslint-disable-next-line @typescript-eslint/only-throw-error
            throw converterFailure;
        }
        return value;
    },
    fromProvider: value => value,
};

class ComplexConcurrencyContext extends DbContext {
    public documents = this.set(ComplexConcurrencyDocument);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(ComplexConcurrencyDocument, entity => {
            entity.toTable('complex_concurrency_documents');
            entity.hasKey(value => value.id);
            entity.property(value => value.id)
                .hasColumnType('text').isRequired();
            entity.property(value => value.title)
                .hasColumnType('text').isRequired();
            entity.complexProperty(
                value => value.revision,
                { constructor: Revision },
                revision => {
                    revision.property(value => value.version)
                        .hasColumnName('revision_version')
                        .hasColumnType('integer').isOptional().isVersion();
                },
            );
            entity.property(value => value.otherVersion)
                .hasColumnName('other_version').hasColumnType('integer')
                .hasConversion(versionConverter).isRequired().isVersion();
        });
    }
}

describe('complex concurrency restoration', () => {
    beforeEach(() => {
        converterFailure = undefined;
    });

    it('removes a created complex ancestor after a later setter failure', async () => {
        const db = await openContext();
        const document = requireDefined(await db.documents.find('doc_1'));
        document.revision = null;
        document.title = 'client';
        db.changeTracker.detectChanges();
        await updateDatabase(db);
        const entry = requireDefined(db.entry(document));
        const values = requireDefined(await entry.getDatabaseValues());
        const primary = Symbol('later version setter failed');
        installVersionFailure(document, primary);

        expect(await rejection(
            async () => entry.resolveConcurrency('clientWins', values),
        )).toBe(primary);
        expect(document).toMatchObject({
            title: 'client', revision: null, otherVersion: 1,
        });
        expect(entry.originalValues).toMatchObject({
            title: 'original',
            'revision.version': 1,
            otherVersion: 1,
        });
        expect(entry.state).toBe(EntityState.Modified);
        await expect(db.documents.count()).resolves.toBe(1);
        await db.dispose();
    });

    it('restores earlier version writes and baselines after converter failure', async () => {
        const db = await openContext();
        const document = requireDefined(await db.documents.find('doc_1'));
        document.title = 'client';
        db.changeTracker.detectChanges();
        await updateDatabase(db);
        const entry = requireDefined(db.entry(document));
        const values = requireDefined(await entry.getDatabaseValues());
        const primary = new Error('version converter failed');
        converterFailure = primary;

        expect(await rejection(
            async () => entry.resolveConcurrency('clientWins', values),
        )).toBe(primary);
        expect(document).toMatchObject({
            title: 'client',
            revision: { version: 1 },
            otherVersion: 1,
        });
        expect(entry.originalValues).toMatchObject({
            title: 'original',
            'revision.version': 1,
            otherVersion: 1,
        });
        expect(entry.state).toBe(EntityState.Modified);
        converterFailure = undefined;
        await expect(db.documents.count()).resolves.toBe(1);
        await db.dispose();
    });
});

async function openContext(): Promise<ComplexConcurrencyContext> {
    const db = ComplexConcurrencyContext.create();
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    db.documents.add(Object.assign(new ComplexConcurrencyDocument(), {
        id: 'doc_1', title: 'original',
        revision: Object.assign(new Revision(), { version: 1 }),
        otherVersion: 1,
    }));
    await db.saveChanges();
    return db;
}

async function updateDatabase(db: ComplexConcurrencyContext): Promise<void> {
    await db.database.connection.query({
        text: 'update complex_concurrency_documents set title = ?, revision_version = ?, other_version = ? where id = ?',
        values: ['database', 2, 2, 'doc_1'],
    });
}

function installVersionFailure(
    document: ComplexConcurrencyDocument,
    primary: unknown,
): void {
    let stored = document.otherVersion;
    Object.defineProperty(document, 'otherVersion', {
        configurable: true,
        enumerable: true,
        get: () => stored,
        set: (value: number) => {
            stored = value;
            if (value === 2) {
                // Deliberately exercise an exact primitive setter failure.
                throw primary;
            }
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
