import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext, EntityState } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { toBindValue } from '../packages/sqlite/src/sqlite-binding';
import { buildGeneratedValueRefresh } from '../packages/core/src/core/unit-of-work/generated-value-refresh';
import { sqliteDialect } from '../packages/sqlite/src';
import { contextModel } from './support/public-api-internals';
import type { EntityMetadata } from '../packages/core/src/model/entity-metadata';
import { ModelBuilder as ModelBuilderImplementation } from '../packages/core/src/model/model-builder';

class NumericRow {
    public id = '';
    public label = '';
    public score: number | null = null;
    public token: number | null = null;
    public deleted: number | null = null;
}

class NumericContext extends DbContext {
    public rows = this.set(NumericRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(NumericRow, entity => {
            entity.toTable('numeric_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.label).hasColumnType('text').isRequired();
            entity.property(row => row.score).hasColumnType('real');
            entity.property(row => row.token).hasColumnType('real')
                .isConcurrencyToken();
            entity.property(row => row.deleted).hasColumnType('real');
        });
    }
}

async function open(): Promise<NumericContext> {
    const db = NumericContext.create();
    await db.database.connection.query({
        text: db.database.createScript(),
        values: [],
    });
    return db;
}

async function seed(db: NumericContext): Promise<void> {
    await db.database.connection.query({
        text: 'insert into numeric_rows (id, label, score, token, deleted) values (?, ?, ?, ?, null)',
        values: ['row-one', 'original', 1, 1],
    });
}

async function stored(db: NumericContext): Promise<Record<string, unknown>> {
    const result = await db.database.connection.query({
        text: 'select label, score, token, deleted from numeric_rows where id = ?',
        values: ['row-one'],
    });
    return result.rows[0] ?? {};
}

describe('SQLite NaN safety', () => {
    it('keeps a direct adapter assertion behind the general SQL guard', () => {
        expect(() => toBindValue(Number.NaN)).toThrow(
            'SQLite parameters cannot contain NaN because SQLite stores it as NULL.',
        );
    });

    it('rejects an insert without accepting or persisting it', async () => {
        const db = await open();
        const row = Object.assign(new NumericRow(), {
            id: 'row-one', label: 'new', score: Number.NaN,
        });
        db.rows.add(row);

        await expect(db.saveChanges()).rejects.toThrow(
            'SQL parameters cannot contain NaN.',
        );

        expect(db.entry(row)?.state).toBe(EntityState.Added);
        expect(await stored(db)).toEqual({});
        await db.dispose();
    });

    it('rejects tracked updates and concurrency predicates', async () => {
        const db = await open();
        await seed(db);
        const update = Object.assign(new NumericRow(), {
            id: 'row-one', label: 'changed', score: 1, token: 1,
        });
        db.rows.attach(update);
        update.score = Number.NaN;
        await expect(db.saveChanges()).rejects.toThrow(
            'SQL parameters cannot contain NaN.',
        );
        expect(await stored(db)).toMatchObject({ label: 'original', score: 1 });

        db.changeTracker.clear();
        const concurrent = Object.assign(new NumericRow(), {
            id: 'row-one', label: 'changed', score: 1, token: Number.NaN,
        });
        db.rows.attach(concurrent);
        concurrent.label = 'concurrent';
        await expect(db.saveChanges()).rejects.toThrow(
            'SQL parameters cannot contain NaN.',
        );
        expect(await stored(db)).toMatchObject({ label: 'original', token: 1 });
        await db.dispose();
    });

    it('rejects query and set-based parameters before SQLite execution', async () => {
        const db = await open();
        await seed(db);
        const nan = Number.NaN;

        await expect(db.rows.where(row => row.score.eq(nan)).toArray())
            .rejects.toThrow('SQL parameters cannot contain NaN.');
        await expect(db.rows.where(row => row.id.eq('row-one'))
            .executeUpdate({ score: nan }))
            .rejects.toThrow('SQL parameters cannot contain NaN.');

        expect(await stored(db)).toMatchObject({ score: 1 });
        await db.dispose();
    });

    it('rejects generated refresh keys and soft-delete markers', async () => {
        const db = await open();
        await seed(db);
        const metadata = contextModel(db).getEntity(NumericRow);
        expect(() => buildGeneratedValueRefresh(
            sqliteDialect,
            metadata as unknown as EntityMetadata,
            [metadata.getProperty('score')],
            () => Number.NaN,
        )).toThrow('SQL parameters cannot contain NaN.');

        const model = new ModelBuilderImplementation();
        model.entity(NumericRow, entity => {
            entity.toTable('numeric_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.deleted).hasColumnType('real');
            entity.softDelete(row => row.deleted, Number.NaN);
        });
        expect(() => model.build()).toThrow(
            'cannot write NaN, because SQL providers do not share NaN persistence semantics',
        );
        await db.dispose();
    });
});
