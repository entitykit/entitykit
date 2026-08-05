import { requireDefined } from './support/require-defined';
import type {
    DbContextOptionsBuilder,
    ModelBuilder } from '../src';
import {
    DbContext,
    EntityState,
    bigintAsBigInt,
} from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';

/**
 * The update statement applies `version = version + 1` in the database, so the
 * in-memory value has to move with it. A version column is not always a
 * JavaScript `number`: `pg` returns `bigint`/`numeric` columns as strings, and a
 * column can map to `bigint` through a converter. Leaving those stale makes the
 * *next* save compare against an outdated version and report a concurrency
 * conflict that never happened.
 */

class Doc {
    public id!: string;
    public title!: string;
    public version!: number;

    constructor(data?: Partial<Doc>) {
        Object.assign(this, data);
    }
}

class BigIntDoc {
    public id!: string;
    public title!: string;
    public version!: bigint;

    constructor(data?: Partial<BigIntDoc>) {
        Object.assign(this, data);
    }
}

class DocContext extends DbContext {
    public docs = this.set(Doc);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Doc, entity => {
            entity.toTable('docs');
            entity.hasKey(doc => doc.id);
            entity.property(doc => doc.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(doc => doc.title).hasColumnName('title').hasColumnType('text').isRequired();
            entity.property(doc => doc.version).hasColumnName('version').hasColumnType('integer').isRequired().isVersion();
        });
    }
}

class BigIntDocContext extends DbContext {
    public docs = this.set(BigIntDoc);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(BigIntDoc, entity => {
            entity.toTable('docs');
            entity.hasKey(doc => doc.id);
            entity.property(doc => doc.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(doc => doc.title).hasColumnName('title').hasColumnType('text').isRequired();
            entity.property(doc => doc.version).hasColumnName('version').hasColumnType('bigint').isRequired()
                .hasConversion(bigintAsBigInt()).isVersion();
        });
    }
}

async function start<TContext extends DbContext>(context: TContext): Promise<TContext> {
    await context.database.connection.query({ text: context.database.createScript(), values: [] });
    return context;
}

describe('version columns keep their in-memory value in step with the database', () => {
    it('increments a number version and allows repeated saves', async () => {
        const db = await start(DocContext.create());
        db.docs.add(new Doc({ id: 'd1', title: 'First', version: 1 }));
        await db.saveChanges();

        const doc = await db.docs.find('d1');
        requireDefined(doc).title = 'Second';
        await db.saveChanges();
        expect(requireDefined(doc).version).toBe(2);

        // The second save is the one that fails when the version goes stale.
        requireDefined(doc).title = 'Third';
        await expect(db.saveChanges()).resolves.toBe(1);
        expect(requireDefined(doc).version).toBe(3);

        const stored = await db.database.connection.query<{ version: number }>({
            text: 'select "version" from "docs" where "id" = ?',
            values: ['d1'],
        });
        expect(stored.rows[0].version).toBe(3);

        await db.dispose();
    });

    it('increments a bigint version mapped through a converter', async () => {
        const db = await start(BigIntDocContext.create());
        db.docs.add(new BigIntDoc({ id: 'd1', title: 'First', version: 1n }));
        await db.saveChanges();

        const doc = await db.docs.find('d1');
        requireDefined(doc).title = 'Second';
        await db.saveChanges();
        expect(requireDefined(doc).version).toBe(2n);

        requireDefined(doc).title = 'Third';
        await expect(db.saveChanges()).resolves.toBe(1);
        expect(requireDefined(doc).version).toBe(3n);

        await db.dispose();
    });

    it.each([false, true])(
        'rejects a manually changed number version before SQL (scalar change: %s)',
        async changeTitle => {
            const db = await start(DocContext.create());
            db.docs.add(new Doc({ id: 'd1', title: 'First', version: 1 }));
            await db.saveChanges();

            const doc = requireDefined(await db.docs.find('d1'));
            if (changeTitle) {
                doc.title = 'Second';
            }
            doc.version = 100;

            await expect(db.saveChanges()).rejects.toThrow(
                'Version property \'Doc.version\' is managed by EntityKit and cannot be modified directly.',
            );
            const stored = await db.database.connection.query<{
                title: string;
                version: number;
            }>({
                text: 'select "title", "version" from "docs" where "id" = ?',
                values: ['d1'],
            });
            expect(stored.rows[0]).toEqual({ title: 'First', version: 1 });
            expect(db.entry(doc)?.state).toBe(EntityState.Modified);
            await db.dispose();
        },
    );

    it('rejects a manually changed converted bigint version', async () => {
        const db = await start(BigIntDocContext.create());
        db.docs.add(new BigIntDoc({ id: 'd1', title: 'First', version: 1n }));
        await db.saveChanges();

        const doc = requireDefined(await db.docs.find('d1'));
        doc.title = 'Second';
        doc.version = 100n;

        await expect(db.saveChanges()).rejects.toThrow(
            'Version property \'BigIntDoc.version\' is managed by EntityKit and cannot be modified directly.',
        );
        expect(doc.version).toBe(100n);
        await db.dispose();
    });
});

describe('version increment across driver representations', () => {
    // Exercised directly because `pg` returns bigint/numeric columns as strings,
    // which no SQLite-backed test can reproduce.
    class StringVersionDoc {
        public id!: string;
        public title!: string;
        public version!: string;

        constructor(data?: Partial<StringVersionDoc>) {
            Object.assign(this, data);
        }
    }

    class StringVersionContext extends DbContext {
        public docs = this.set(StringVersionDoc);

        protected override configure(options: DbContextOptionsBuilder): void {
            options.useProvider(sqliteProviderServices, ':memory:');
        }

        protected override model(model: ModelBuilder): void {
            model.entity(StringVersionDoc, entity => {
                entity.toTable('docs');
                entity.hasKey(doc => doc.id);
                entity.property(doc => doc.id).hasColumnName('id').hasColumnType('text').isRequired();
                entity.property(doc => doc.title).hasColumnName('title').hasColumnType('text').isRequired();
                entity.property(doc => doc.version).hasColumnName('version').hasColumnType('text').isRequired().isVersion();
            });
        }
    }

    it('increments an integer string without losing precision or changing type', async () => {
        const db = await start(StringVersionContext.create());
        db.docs.add(new StringVersionDoc({ id: 'd1', title: 'First', version: '9007199254740993' }));
        await db.saveChanges();

        const doc = await db.docs.find('d1');
        expect(typeof requireDefined(doc).version).toBe('string');

        requireDefined(doc).title = 'Second';
        await db.saveChanges();

        // Beyond 2^53, so a number round-trip would round it.
        expect(requireDefined(doc).version).toBe('9007199254740994');
        expect(typeof requireDefined(doc).version).toBe('string');

        await db.dispose();
    });

    it('rejects an application-modified version before SQL and remains retryable', async () => {
        class OddVersionDoc {
            public id!: string;
            public title!: string;
            public version!: unknown;

            constructor(data?: Partial<OddVersionDoc>) {
                Object.assign(this, data);
            }
        }

        class OddVersionContext extends DbContext {
            public docs = this.set(OddVersionDoc);

            protected override configure(options: DbContextOptionsBuilder): void {
                options.useProvider(sqliteProviderServices, ':memory:');
            }

            protected override model(model: ModelBuilder): void {
                model.entity(OddVersionDoc, entity => {
                    entity.toTable('docs');
                    entity.hasKey(doc => doc.id);
                    entity.property(doc => doc.id).hasColumnName('id').hasColumnType('text').isRequired();
                    entity.property(doc => doc.title).hasColumnName('title').hasColumnType('text').isRequired();
                    entity.property(doc => doc.version).hasColumnName('version').hasColumnType('text').isRequired().isVersion();
                });
            }
        }

        const db = await start(OddVersionContext.create());
        db.docs.add(new OddVersionDoc({ id: 'd1', title: 'First', version: '1' }));
        await db.saveChanges();

        const doc = await db.docs.find('d1');
        requireDefined(doc).title = 'Second';
        requireDefined(doc).version = 'not-a-number';

        await expect(db.saveChanges()).rejects.toThrow(
            'Version property \'OddVersionDoc.version\' is managed by EntityKit and cannot be modified directly.',
        );

        expect(db.entry(requireDefined(doc))?.state).toBe(EntityState.Modified);
        expect(requireDefined(doc).version).toBe('not-a-number');
        const rejected = await db.database.connection.query<{ title: string; version: string }>({
            text: 'select "title", "version" from "docs" where "id" = ?',
            values: ['d1'],
        });
        expect(rejected.rows[0]).toEqual({ title: 'First', version: '1' });

        requireDefined(doc).version = '1';
        await expect(db.saveChanges()).resolves.toBe(1);
        expect(requireDefined(doc).version).toBe('2');
        expect(db.entry(requireDefined(doc))?.state).toBe(EntityState.Unchanged);

        await db.dispose();
    });
});
