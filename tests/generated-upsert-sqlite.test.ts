import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, UniqueConstraintError } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';

class GeneratedUpsertRow {
    public id = 0;
    public sku = '';
    public label = '';
    public createdAt?: Date;
    public updatedAt?: Date;
}

class GeneratedUpsertContext extends DbContext {
    public rows = this.set(GeneratedUpsertRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(GeneratedUpsertRow, entity => {
            entity.toTable('generated_upsert_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer')
                .isRequired().useSqliteRowId({ preventReuse: true });
            entity.property(row => row.sku).hasColumnType('text').isRequired();
            entity.property(row => row.label).hasColumnType('text').isRequired();
            entity.property(row => row.createdAt).hasColumnName('created_at')
                .hasColumnType('timestamp').isRequired()
                .hasDefaultSql('current_timestamp').valueGeneratedOnAdd();
            entity.property(row => row.updatedAt).hasColumnName('updated_at')
                .hasColumnType('timestamp').isRequired()
                .hasDefaultSql('current_timestamp')
                .valueGeneratedOnAddOrUpdate();
            entity.hasIndex(row => row.sku).isUnique();
            entity.hasIndex(row => row.label).isUnique();
        });
    }
}

function row(sku: string, label: string): GeneratedUpsertRow {
    return Object.assign(new GeneratedUpsertRow(), { sku, label });
}

async function open(): Promise<GeneratedUpsertContext> {
    const db = GeneratedUpsertContext.create();
    await db.database.connection.query({
        text: db.database.createScript(),
        values: [],
    });
    return db;
}

const naturalKeyOptions = {
    conflictProperties: ['sku'] as const,
    updateProperties: ['label'] as const,
};

describe('SQLite generated-value upsert', () => {
    it('rejects an unresolved generated primary-key conflict target', async () => {
        const db = await open();
        const incoming = row('sku-one', 'one');

        await expect(db.rows.upsert([incoming])).rejects.toThrow(
            'cannot use unresolved store-generated key \'id\' as its conflict target',
        );

        expect(incoming.id).toBe(0);
        expect(incoming.createdAt).toBeUndefined();
        expect(await db.rows.count()).toBe(0);
        await db.dispose();
    });

    it('hydrates generated identities and defaults through a natural key', async () => {
        const db = await open();
        const first = row('sku-one', 'one');
        const second = row('sku-two', 'two');

        await expect(db.rows.upsert(
            [first, second],
            naturalKeyOptions,
        )).resolves.toBe(2);

        expect(first.id).toBe(1);
        expect(second.id).toBe(2);
        expect(first.createdAt).toBeInstanceOf(Date);
        expect(first.updatedAt).toBeInstanceOf(Date);
        expect(second.createdAt).toBeInstanceOf(Date);
        expect(second.updatedAt).toBeInstanceOf(Date);
        expect(await db.rows.count()).toBe(2);
        await db.dispose();
    });

    it('hydrates the stored generated values after a natural-key conflict', async () => {
        const db = await open();
        const stored = row('sku-one', 'before');
        await db.rows.upsert([stored], naturalKeyOptions);
        const incoming = row('sku-one', 'after');

        await expect(db.rows.upsert([incoming], naturalKeyOptions))
            .resolves.toBe(1);

        expect(incoming.id).toBe(stored.id);
        expect(incoming.createdAt).toEqual(stored.createdAt);
        expect(incoming.updatedAt).toEqual(stored.updatedAt);
        expect(await db.rows.toArray()).toEqual([
            expect.objectContaining({
                id: stored.id,
                sku: 'sku-one',
                label: 'after',
            }),
        ]);
        await db.dispose();
    });

    it('rejects explicit updates to store-generated properties', async () => {
        const db = await open();

        await expect(db.rows.upsert([row('sku-one', 'one')], {
            conflictProperties: ['sku'],
            updateProperties: ['label', 'createdAt'],
        })).rejects.toThrow(
            'cannot include store-generated property \'GeneratedUpsertRow.createdAt\'',
        );

        expect(await db.rows.count()).toBe(0);
        await db.dispose();
    });

    it('restores hydrated values when a later generated row fails', async () => {
        const db = await open();
        const first = row('sku-one', 'duplicate-label');
        const second = row('sku-two', 'duplicate-label');

        await expect(db.rows.upsert(
            [first, second],
            naturalKeyOptions,
        )).rejects.toBeInstanceOf(UniqueConstraintError);

        expect(first.id).toBe(0);
        expect(first.createdAt).toBeUndefined();
        expect(first.updatedAt).toBeUndefined();
        expect(second.id).toBe(0);
        expect(await db.rows.count()).toBe(0);
        await db.dispose();
    });
});
