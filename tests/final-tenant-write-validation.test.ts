import { EntityState } from '../src';
import { SaveTimeWrites } from '../src/core/save-time-writes';
import { EntityMetadata } from '../src/model/entity-metadata';
import { ModelBuilder } from '../src/model/model-builder';
import { EntityEntry } from '../src/tracking/entity-entry';
import { capturePersistedEntrySnapshot } from '../src/tracking/persisted-entry-snapshot';
import { RestorationScope } from '../src/restoration-scope';

class TenantAuditRow {
    public id = '';
    public tenantId = '';
}

function overlappingTenantAuditMetadata(): EntityMetadata<TenantAuditRow> {
    const valid = new ModelBuilder().entity(TenantAuditRow, entity => {
        entity.toTable('tenant_audit_rows');
        entity.hasKey(row => row.id);
        entity.property(row => row.id).hasColumnType('text').isRequired();
        entity.property(row => row.tenantId)
            .hasColumnName('tenant_id').hasColumnType('text').isRequired();
        entity.tenantKey(row => row.tenantId);
    }).build().getEntity(TenantAuditRow);

    return new EntityMetadata({
        ctor: TenantAuditRow,
        tableName: valid.tableName,
        keyProperties: valid.keyProperties,
        properties: valid.properties,
        tenantKeyProperty: 'tenantId',
        audit: { updatedByProperty: 'tenantId' },
    });
}

describe('final tenant write validation', () => {
    it('rejects any policy write that changes the prepared tenant value', () => {
        const entity = Object.assign(new TenantAuditRow(), { id: 'row-one' });
        const entry = new EntityEntry(
            entity,
            overlappingTenantAuditMetadata(),
            EntityState.Added,
        );
        const writes = new SaveTimeWrites({
            now: () => new Date('2026-08-10T12:00:00.000Z'),
            currentUserId: () => 'user-two',
            currentTenantId: () => 'tenant-one',
            allowsCrossTenantAccess: () => false,
        });
        writes.begin();

        expect(() => writes.applyTo([
            capturePersistedEntrySnapshot(
                entry as unknown as EntityEntry<object>,
            ),
        ], new RestorationScope(() => undefined))).toThrow(
            'Entity \'TenantAuditRow\' tenant key \'tenantId\' must match the current tenant scope.',
        );

        writes.restore();
        expect(entity.tenantId).toBe('');
    });
});
