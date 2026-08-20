import type { EntityBuilder } from '../packages/core/src';
import { ModelBuilder as ModelBuilderImplementation } from '../packages/core/src/model/model-builder';

class RoleRow {
    public id = '';
    public partition = '';
    public alternate = '';
    public tenantId = '';
    public version = 0;
    public marker: Date | null = null;
    public createdAt?: Date;
    public updatedAt?: Date;
    public createdBy = '';
    public updatedBy = '';
    public payload = '';
}

type ConfigureRoles = (entity: EntityBuilder<RoleRow>) => void;

function model(configure: ConfigureRoles): ModelBuilderImplementation {
    return new ModelBuilderImplementation().entity(RoleRow, entity => {
        entity.toTable('role_rows');
        entity.hasKey(row => [row.id, row.partition]);
        entity.hasAlternateKey(row => row.alternate);
        entity.property(row => row.id).hasColumnType('text').isRequired();
        entity.property(row => row.partition).hasColumnType('text').isRequired();
        entity.property(row => row.alternate).hasColumnType('text');
        entity.property(row => row.tenantId).hasColumnName('tenant_id')
            .hasColumnType('text').isRequired();
        entity.property(row => row.version).hasColumnType('integer').isRequired();
        entity.property(row => row.marker).hasColumnType('timestamp');
        entity.property(row => row.createdAt).hasColumnName('created_at')
            .hasColumnType('timestamp');
        entity.property(row => row.updatedAt).hasColumnName('updated_at')
            .hasColumnType('timestamp');
        entity.property(row => row.createdBy).hasColumnName('created_by')
            .hasColumnType('text').isRequired();
        entity.property(row => row.updatedBy).hasColumnName('updated_by')
            .hasColumnType('text').isRequired();
        entity.property(row => row.payload).hasColumnType('text').isRequired();
        configure(entity);
    });
}

function rejects(
    configure: ConfigureRoles,
    firstRole: string,
    secondRole: string,
    propertyName: keyof RoleRow,
): void {
    expect(() => model(configure).build()).toThrow(
        `Property 'RoleRow.${propertyName}' cannot combine ${firstRole} and ${secondRole} roles`,
    );
}

describe('entity property role compatibility', () => {
    it('rejects a tenant version', () => {
        rejects(entity => {
            entity.property(row => row.tenantId).isVersion();
            entity.tenantKey(row => row.tenantId);
        }, 'tenant', 'version', 'tenantId');
    });

    it.each([
        ['createdAt audit', (entity: EntityBuilder<RoleRow>) =>
            entity.audit({ createdAt: row => row.tenantId })],
        ['updatedAt audit', (entity: EntityBuilder<RoleRow>) =>
            entity.audit({ updatedAt: row => row.tenantId })],
        ['createdBy audit', (entity: EntityBuilder<RoleRow>) =>
            entity.audit({ createdBy: row => row.tenantId })],
        ['updatedBy audit', (entity: EntityBuilder<RoleRow>) =>
            entity.audit({ updatedBy: row => row.tenantId })],
    ] as const)('rejects tenant plus %s', (role, audit) => {
        rejects(entity => {
            audit(entity);
            entity.tenantKey(row => row.tenantId);
        }, 'tenant', role, 'tenantId');
    });

    it('rejects a tenant soft-delete marker', () => {
        rejects(entity => {
            entity.tenantKey(row => row.marker);
            entity.softDelete(row => row.marker);
        }, 'tenant', 'soft-delete', 'marker');
    });

    it.each(['id', 'partition'] as const)(
        'rejects version on composite primary-key property %s',
        propertyName => {
            rejects(entity => {
                entity.property(propertyName).isVersion();
            }, 'version', 'primary-key', propertyName);
        },
    );

    it('rejects a version alternate key', () => {
        rejects(entity => {
            entity.property(row => row.alternate).isVersion();
        }, 'version', 'alternate-key', 'alternate');
    });

    it('rejects a version soft-delete marker', () => {
        rejects(entity => {
            entity.property(row => row.marker).isVersion();
            entity.softDelete(row => row.marker);
        }, 'version', 'soft-delete', 'marker');
    });

    it('rejects a version audit property', () => {
        rejects(entity => {
            entity.property(row => row.updatedAt).isVersion();
            entity.audit({ updatedAt: row => row.updatedAt });
        }, 'version', 'updatedAt audit', 'updatedAt');
    });

    it('rejects a soft-delete audit property', () => {
        rejects(entity => {
            entity.softDelete(row => row.marker);
            entity.audit({ updatedAt: row => row.marker });
        }, 'soft-delete', 'updatedAt audit', 'marker');
    });

    it('rejects soft deletion through an alternate key', () => {
        rejects(entity => {
            entity.softDelete(row => row.alternate, 'deleted');
        }, 'soft-delete', 'alternate-key', 'alternate');
    });

    it('rejects soft deletion through an optional primary key', () => {
        rejects(entity => {
            entity.property(row => row.id).isOptional();
            entity.softDelete(row => row.id, 'deleted');
        }, 'soft-delete', 'primary-key', 'id');
    });

    it('rejects audit writes through immutable keys', () => {
        rejects(entity => {
            entity.audit({ createdBy: row => row.id });
        }, 'createdBy audit', 'primary-key', 'id');
        rejects(entity => {
            entity.audit({ updatedBy: row => row.alternate });
        }, 'updatedBy audit', 'alternate-key', 'alternate');
    });

    it.each([
        ['createdAt', 'updatedAt'],
        ['createdAt', 'createdBy'],
        ['createdAt', 'updatedBy'],
        ['updatedAt', 'createdBy'],
        ['updatedAt', 'updatedBy'],
        ['createdBy', 'updatedBy'],
    ] as const)('rejects duplicate %s and %s audit roles', (first, second) => {
        const selector = (row: RoleRow): Date | undefined => row.updatedAt;
        expect(() => model(entity => {
            entity.audit({
                [first]: selector,
                [second]: selector,
            });
        }).build()).toThrow(
            /cannot combine .* audit and .* audit roles/,
        );
    });

    it('accepts distinct roles and an audit concurrency token', () => {
        const configured = model(entity => {
            entity.tenantKey(row => row.tenantId);
            entity.property(row => row.version).isVersion();
            entity.property(row => row.updatedAt).isConcurrencyToken();
            entity.softDelete(row => row.marker);
            entity.audit({
                createdAt: row => row.createdAt,
                updatedAt: row => row.updatedAt,
                createdBy: row => row.createdBy,
                updatedBy: row => row.updatedBy,
            });
        }).build().getEntity(RoleRow);

        expect(configured.tenantKeyProperty).toBe('tenantId');
        expect(configured.softDelete?.propertyName).toBe('marker');
        expect(configured.getProperty('updatedAt').isConcurrencyToken).toBe(true);
    });
});
