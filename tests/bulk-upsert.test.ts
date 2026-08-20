import { ModelBuilder as ModelBuilderImplementation } from '../packages/core/src/model/model-builder';
import type { EntityMetadata } from '../packages/core/src/model/entity-metadata';
import {
    TenantOwnershipError,
    UniqueConstraintError,
} from '../packages/core/src';
import { ModificationSqlBuilder } from '../packages/core/src/sql/modification-sql-builder';
import { postgresDialect } from '../packages/core/src/sql/sql-dialect';
import { mySqlDialect } from '../packages/mysql/src';
import { sqliteDialect } from '../packages/sqlite/src';
import {
    bulkUpsertFixture,
    Item,
    item,
    openBulkUpsertDb as open,
} from './support/bulk-upsert-fixture';

beforeEach(() => {
    bulkUpsertFixture.reset();
});

describe('bulk upsert', () => {
    it('inserts rows that do not exist', async () => {
        const db = await open();

        expect(await db.items.upsert([item('a'), item('b')])).toBe(2);
        expect((await db.items.orderBy(row => row.id).toArray()).map(row => row.id)).toEqual(['a', 'b']);
        await db.dispose();
    });

    it('overwrites rows that do', async () => {
        const db = await open();
        await db.items.upsert([item('a', { name: 'First', quantity: 1 })]);

        await db.items.upsert([item('a', { name: 'Second', quantity: 9 })]);

        expect(await db.items.find('a')).toMatchObject({ name: 'Second', quantity: 9 });
        await db.dispose();
    });

    it('handles a mix of new and existing rows in one call', async () => {
        const db = await open();
        await db.items.upsert([item('a', { name: 'Old' })]);

        const affected = await db.items.upsert([item('a', { name: 'New' }), item('b')]);

        expect(affected).toBe(2);
        expect(await db.items.count()).toBe(2);
        expect(await db.items.find('a')).toMatchObject({ name: 'New' });
        await db.dispose();
    });

    it('conflicts on a natural key when asked to', async () => {
        const db = await open();
        await db.items.upsert([item('a', { sku: 'widget', name: 'First' })]);

        // Different primary key, same natural key: the existing row is updated
        // rather than a duplicate inserted.
        await db.items.upsert([item('b', { sku: 'widget', name: 'Second' })], {
            conflictProperties: ['tenantId', 'sku'],
            updateProperties: ['name', 'quantity'],
        });

        const rows = await db.items.toArray();
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ id: 'a', sku: 'widget', name: 'Second' });
        await db.dispose();
    });

    it('overwrites only the properties it was told to', async () => {
        const db = await open();
        await db.items.upsert([item('a', { name: 'Keep', quantity: 5 })]);

        await db.items.upsert([item('a', { name: 'Ignored', quantity: 99 })], { updateProperties: ['quantity'] });

        expect(await db.items.find('a')).toMatchObject({ name: 'Keep', quantity: 99 });
        await db.dispose();
    });

    it('does nothing, and issues nothing, for an empty list', async () => {
        const db = await open();

        expect(await db.items.upsert([])).toBe(0);
        expect(db.plans).toHaveLength(0);
        await db.dispose();
    });

    describe('tenant scope', () => {
        it('refuses an entity belonging to another tenant', async () => {
            // The rule saveChanges() applies. A set-based write must not be the way
            // around an isolation boundary the tracked path enforces.
            const db = await open();

            await expect(db.items.upsert([item('a'), item('b', { tenantId: 't2' })]))
                .rejects.toThrow(/tenant key 'tenantId' must match the current tenant scope/);

            expect(await db.items.count()).toBe(0);
            await db.dispose();
        });

        it('fills in a missing tenant key from the current scope', async () => {
            const db = await open();
            const incoming = new Item({ id: 'a', sku: 's', name: 'N', quantity: 1 });

            await db.items.upsert([incoming]);

            expect(incoming.tenantId).toBe('t1');
            expect(await db.items.find('a')).toMatchObject({ tenantId: 't1' });
            await db.dispose();
        });

        it('fails closed when the current tenant disappears', async () => {
            const db = await open();
            bulkUpsertFixture.useTenant(undefined);

            await expect(db.items.upsert([item('a')]))
                .rejects.toThrow('Tenant scope is unavailable');
            expect(await db.items.ignoreTenantScope().count()).toBe(0);
            await db.dispose();
        });

        it('accepts multiple tenant identities in an explicit cross-tenant context', async () => {
            bulkUpsertFixture.allowCrossTenantAccess();
            bulkUpsertFixture.useTenant(undefined);
            const db = await open();

            await expect(db.items.upsert([
                item('a', { tenantId: 't1' }),
                item('b', { tenantId: 't2' }),
            ])).resolves.toBe(2);
            await expect(db.items.count()).resolves.toBe(2);
            await db.dispose();
        });

        it('imposes nothing when the entity has no tenant key', async () => {
            bulkUpsertFixture.withoutTenantKey();
            const db = await open();

            expect(await db.items.upsert([item('a', { tenantId: 'anything' })])).toBe(1);
            await db.dispose();
        });

        it('does not update a conflicting row owned by another tenant', async () => {
            const db = await open();
            await db.database.connection.query({
                text: `insert into items (id, tenant_id, sku, name, quantity)
                    values (?, ?, ?, ?, ?)`,
                values: ['shared', 't2', 't2-sku', 'Tenant two', 7],
            });

            await expect(db.items.upsert([
                item('shared', { name: 'Hijacked' }),
            ], { updateProperties: ['name'] }))
                .rejects.toBeInstanceOf(TenantOwnershipError);

            const stored = await db.database.connection.query<{
                tenant_id: string;
                name: string;
                quantity: number;
            }>({
                text: 'select tenant_id, name, quantity from items where id = ?',
                values: ['shared'],
            });
            expect(stored.rows).toEqual([{
                tenant_id: 't2', name: 'Tenant two', quantity: 7,
            }]);
            await db.dispose();
        });

        it('never accepts the tenant key as an upsert update property', async () => {
            const db = await open();

            await expect(db.items.upsert([item('a')], {
                updateProperties: ['tenantId', 'name'],
            })).rejects.toThrow(
                'cannot include tenant property \'Item.tenantId\'',
            );
            expect(await db.items.count()).toBe(0);
            await db.dispose();
        });
    });

    describe('batching', () => {
        it('splits a list too large to bind into statements that fit', async () => {
            // 5 columns per row against SQLite's 32_766 cap is 6553 rows per
            // statement, so 8000 needs two.
            const db = await open();
            const many = Array.from({ length: 8000 }, (_, index) => item(`r${String(index)}`));

            expect(await db.items.upsert(many)).toBe(8000);
            expect(await db.items.count()).toBe(8000);

            const executed = db.plans.filter(plan => plan.phase === 'execute' && plan.shape.operation === 'upsert');
            expect(executed.length).toBeGreaterThan(1);
            await db.dispose();
        }, 60000);

        it('keeps a split upsert inside one transaction', async () => {
            const db = await open();
            // A second row carrying the same natural key as one far later in the
            // list: the unique index rejects it, and nothing may survive.
            const many = Array.from({ length: 8000 }, (_, index) => item(`r${String(index)}`));
            many[7999] = item('r7999', { sku: 'sku-r0' });

            await expect(db.items.upsert(many)).rejects.toThrow(UniqueConstraintError);

            expect(await db.items.count()).toBe(0);
            await db.dispose();
        }, 60000);

        it('rolls back split batches to a savepoint when the caller catches', async () => {
            const db = await open();
            const many = Array.from({ length: 8000 }, (_, index) => item(`r${String(index)}`));
            many[7999] = item('r7999', { sku: 'sku-r0' });

            await db.transaction(async tx => {
                await expect(tx.items.upsert(many))
                    .rejects.toThrow(UniqueConstraintError);
                expect(await tx.items.count()).toBe(0);
            });

            expect(await db.items.count()).toBe(0);
            await db.dispose();
        }, 60000);
    });

    describe('refuses clearly', () => {
        it('when every property is part of the conflict target', async () => {
            const db = await open();

            await expect(db.items.upsert([item('a')], {
                conflictProperties: ['id', 'tenantId', 'sku', 'name', 'quantity'],
            })).rejects.toThrow(/has nothing to update.*add\(\.\.\.\) with saveChanges/s);
            await db.dispose();
        });

        it('when an update property is also a conflict property', async () => {
            const db = await open();

            await expect(db.items.upsert([item('a')], {
                conflictProperties: ['sku'],
                updateProperties: ['sku', 'name'],
            })).rejects.toThrow(/cannot include conflict property 'Item.sku'/);
            await db.dispose();
        });

        it('when the provider cannot express an upsert', () => {
            const withoutUpsert = { ...postgresDialect, upsertClause: undefined };
            const builder = new ModificationSqlBuilder(withoutUpsert);
            const metadata = new CatalogDbContextMetadataProbe().metadata;

            expect(() => builder.buildUpsertBatch(metadata, [item('a')]))
                .toThrow(/'postgres' dialect does not support upsert.*add\(\.\.\.\) with saveChanges/s);
        });

        it('when MySQL is asked to target a non-primary conflict key', () => {
            const builder = new ModificationSqlBuilder(mySqlDialect);
            const metadata = new CatalogDbContextMetadataProbe().metadata;

            expect(() => builder.buildUpsertBatch(metadata, [item('a')], {
                conflictProperties: ['tenantId', 'sku'],
                updateProperties: ['name'],
            })).toThrow(/'mysql' dialect cannot target upsert conflict properties.*fires for any primary or unique key/s);
        });

        it('when scoped MySQL conflict identity omits the tenant', () => {
            const builder = new ModificationSqlBuilder(mySqlDialect);
            const metadata = new CatalogDbContextMetadataProbe(true).metadata;

            expect(() => builder.buildUpsertBatch(
                metadata,
                [item('a')],
                {},
                'tenantId',
            )).toThrow(/cannot safely tenant-scope upsert.*must be part of its primary-key conflict target/s);
        });

        it('when a MySQL model has a secondary unique key', () => {
            const builder = new ModificationSqlBuilder(mySqlDialect);
            const metadata = createIndexedCatalogMetadata();

            expect(() => builder.buildUpsertBatch(metadata, [item('a')]))
                .toThrow(/cannot safely upsert 'Item'.*secondary unique key on \(tenantId, sku\).*instead of the primary-key row/s);
        });
    });

    it('compiles a MySQL upsert when the primary key is the only unique key', () => {
        const builder = new ModificationSqlBuilder(mySqlDialect);
        const metadata = new CatalogDbContextMetadataProbe().metadata;

        expect(builder.buildUpsertBatch(metadata, [item('a')])).toEqual({
            text: 'insert into `items` (`id`, `tenant_id`, `sku`, `name`, `quantity`) values (?, ?, ?, ?, ?) ' +
        'on duplicate key update `tenant_id` = values(`tenant_id`), `sku` = values(`sku`), ' +
        '`name` = values(`name`), `quantity` = values(`quantity`)',
            values: ['a', 't1', 'sku-a', 'Name a', 1],
        });
    });

    it('declares the clause on all shipped dialects, in each provider\'s own spelling', () => {
    // Kept in the dialect rather than branching on the provider name in shared
    // code, the same way ordering, paging, and parameter limits are.
        expect(postgresDialect.upsertClause?.(['id'], ['name']))
            .toBe('on conflict ("id") do update set "name" = excluded."name"');
        expect(sqliteDialect.upsertClause?.(['id'], ['name']))
            .toBe('on conflict ("id") do update set "name" = excluded."name"');
        expect(mySqlDialect.upsertClause?.(['id'], ['name']))
            .toBe('on duplicate key update `name` = values(`name`)');
        expect(mySqlDialect.upsertConflictTarget).toBe('anyUnique');
    });
});

/** Reaches the built metadata without exposing a context just for the test. */
class CatalogDbContextMetadataProbe {
    constructor(private readonly tenantScoped = false) {}

    public readonly metadata = (() => {
        const model = new ModelBuilderImplementation();
        model.entity(Item, entity => {
            entity.toTable('items');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id').hasColumnType('text').isRequired();
            entity.property(row => row.sku).hasColumnName('sku').hasColumnType('text').isRequired();
            entity.property(row => row.name).hasColumnName('name').hasColumnType('text').isRequired();
            entity.property(row => row.quantity).hasColumnName('quantity').hasColumnType('integer').isRequired();
            if (this.tenantScoped) entity.tenantKey(row => row.tenantId);
        });
        return model.build().getEntity(Item);
    })();
}

function createIndexedCatalogMetadata(): EntityMetadata<Item> {
    const model = new ModelBuilderImplementation();
    model.entity(Item, entity => {
        entity.toTable('items');
        entity.hasKey(row => row.id);
        entity.property(row => row.id).hasColumnName('id').hasColumnType('text').isRequired();
        entity.property(row => row.tenantId).hasColumnName('tenant_id').hasColumnType('text').isRequired();
        entity.property(row => row.sku).hasColumnName('sku').hasColumnType('text').isRequired();
        entity.property(row => row.name).hasColumnName('name').hasColumnType('text').isRequired();
        entity.property(row => row.quantity).hasColumnName('quantity').hasColumnType('integer').isRequired();
        entity.hasIndex(row => [row.tenantId, row.sku]).isUnique();
    });
    return model.build().getEntity(Item);
}
