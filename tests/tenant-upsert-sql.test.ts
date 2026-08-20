import { ModelBuilder as ModelBuilderImplementation } from '../packages/core/src/model/model-builder';
import { ModificationSqlBuilder } from '../packages/core/src/sql/modification-sql-builder';
import { postgresDialect } from '../packages/core/src/sql/postgres-dialect';

class TenantItem {
    public id = '';
    public tenantId = '';
    public name = '';
}

describe('tenant upsert SQL', () => {
    it('qualifies the Postgres guard against the conflict target', () => {
        const model = new ModelBuilderImplementation();
        model.entity(TenantItem, entity => {
            entity.toTable('tenant_items');
            entity.hasKey(row => row.id);
            entity.tenantKey(row => row.tenantId);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
        });
        const metadata = model.build().getEntity(TenantItem);
        const item = Object.assign(new TenantItem(), {
            id: 'shared', tenantId: 'tenant-1', name: 'new',
        });

        expect(new ModificationSqlBuilder(postgresDialect).buildUpsertBatch(
            metadata,
            [item],
            { updateProperties: ['name'] },
            'tenantId',
        ).text).toContain(
            'where "tenant_items"."tenant_id" = excluded."tenant_id"',
        );
    });
});
