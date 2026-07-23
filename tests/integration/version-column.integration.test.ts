import { requireDefined } from '../support/require-defined';
import type { DbContextOptionsBuilder, ModelBuilder } from '../../src';
import { DbContext } from '../../src';
import { postgresProviderServices } from '../../src/providers/postgres';

const shouldRunPostgresTests = process.env.RUN_POSTGRES_TESTS === 'true' && Boolean(process.env.DATABASE_URL);
const describePostgres = shouldRunPostgresTests ? describe : describe.skip;

class Doc {
    public id!: string;
    public title!: string;
    public version!: number;

    constructor(data?: Partial<Doc>) {
        Object.assign(this, data);
    }
}

class DocContext extends DbContext {
    public docs = this.set(Doc);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(postgresProviderServices, requireDefined(process.env.DATABASE_URL));
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Doc, entity => {
            entity.toTable('version_docs');
            entity.hasKey(doc => doc.id);
            entity.property(doc => doc.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(doc => doc.title).hasColumnName('title').hasColumnType('text').isRequired();
            // `pg` returns bigint columns as strings, which is what made the
            // in-memory version go stale after the first save.
            entity.property(doc => doc.version).hasColumnName('version').hasColumnType('bigint').isRequired().isVersion();
        });
    }
}

describePostgres('bigint version columns against live Postgres', () => {
    let db: DocContext;

    beforeEach(async () => {
        db = DocContext.create();
        await db.database.connection.query({ text: 'drop table if exists "version_docs" cascade', values: [] });
        await db.database.connection.query({ text: db.database.createScript(), values: [] });
        db.docs.add(new Doc({ id: 'd1', title: 'First', version: 1 }));
        await db.saveChanges();
        db.changeTracker.clear();
    });

    afterEach(async () => {
        await db.database.connection.query({ text: 'drop table if exists "version_docs" cascade', values: [] });
        await db.dispose();
    });

    it('keeps the in-memory version in step so repeated saves succeed', async () => {
        const doc = await db.docs.find('d1');
        // The driver hands back a string, not a number.
        expect(typeof requireDefined(doc).version).toBe('string');

        requireDefined(doc).title = 'Second';
        await expect(db.saveChanges()).resolves.toBe(1);

        const afterFirst = await db.database.connection.query<{ version: string }>({
            text: 'select "version"::text as version from "version_docs" where "id" = $1',
            values: ['d1'],
        });
        expect(afterFirst.rows[0].version).toBe('2');
        expect(String(requireDefined(doc).version)).toBe('2');

        // Without the in-memory increment this second save compared against version
        // 1 and failed as a concurrency conflict that never happened.
        requireDefined(doc).title = 'Third';
        await expect(db.saveChanges()).resolves.toBe(1);

        const afterSecond = await db.database.connection.query<{ version: string; title: string }>({
            text: 'select "version"::text as version, "title" from "version_docs" where "id" = $1',
            values: ['d1'],
        });
        expect(afterSecond.rows[0]).toEqual({ version: '3', title: 'Third' });
    });

    it('still detects a genuine concurrency conflict', async () => {
        const doc = await db.docs.find('d1');

        // Simulate another writer bumping the row out from under this context.
        await db.database.connection.query({
            text: 'update "version_docs" set "version" = "version" + 1 where "id" = $1',
            values: ['d1'],
        });

        requireDefined(doc).title = 'Conflicting';
        await expect(db.saveChanges()).rejects.toThrow(/[Cc]oncurrency/);
    });
});
