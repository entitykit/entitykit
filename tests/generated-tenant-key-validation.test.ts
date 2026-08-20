import type { PropertyBuilder, ValueConverter } from '../packages/core/src';
import { EntityState, ValueGenerated, valueConverter } from '../packages/core/src';
import { buildInsertSavePlanEntry } from '../packages/core/src/core/save-plan/insert-plan';
import { EntityMetadata } from '../packages/core/src/model/entity-metadata';
import { ModelBuilder as ModelBuilderImplementation } from '../packages/core/src/model/model-builder';
import { ModificationSqlBuilder } from '../packages/core/src/sql/modification-sql-builder';
import { upsertGeneratedProperties } from '../packages/core/src/sql/upsert-property-selection';
import { EntityEntry } from '../packages/core/src/tracking/entity-entry';
import { capturePersistedEntrySnapshot } from '../packages/core/src/tracking/persisted-entry-snapshot';

class GeneratedTenantRow {
    public id = '';
    public tenantId = '';
    public label = '';
}

function generatedTenantModel(
    configure: (property: PropertyBuilder<string>) => void,
): ModelBuilderImplementation {
    return new ModelBuilderImplementation().entity(GeneratedTenantRow, entity => {
        entity.toTable('generated_tenant_rows');
        entity.hasKey(row => row.id);
        entity.property(row => row.id).hasColumnType('text').isRequired();
        configure(entity.property(row => row.tenantId)
            .hasColumnName('tenant_id').hasColumnType('text').isRequired());
        entity.property(row => row.label).hasColumnType('text').isRequired();
        entity.tenantKey(row => row.tenantId);
    });
}

class GeneratedTenantNumber {
    public tenantId = 0;
    public label = '';
}

class TenantId {
    constructor(public readonly value: string) {}
}

const tenantConverter: ValueConverter<TenantId, string> = valueConverter({
    toProvider: tenant => tenant.value,
    fromProvider: value => new TenantId(value),
});

class GeneratedTenantScope {
    public tenantId?: TenantId;
}

class NestedGeneratedTenantRow {
    public id = '';
    public scope: GeneratedTenantScope | null = null;
}

function invalidMetadata(): EntityMetadata<GeneratedTenantRow> {
    const valid = generatedTenantModel(() => undefined)
        .build().getEntity(GeneratedTenantRow);
    return new EntityMetadata({
        ctor: GeneratedTenantRow,
        tableName: valid.tableName,
        keyProperties: valid.keyProperties,
        tenantKeyProperty: 'tenantId',
        properties: valid.properties.map(property =>
            property.propertyName === 'tenantId'
                ? {
                    ...property,
                    defaultSql: '\'t2\'',
                    valueGenerated: ValueGenerated.OnAdd,
                }
                : property),
    });
}

describe('generated tenant key validation', () => {
    it.each([
        ['generated on add', (property: PropertyBuilder<string>) =>
            property.hasDefaultSql('\'t2\'').valueGeneratedOnAdd()],
        ['generated on add or update', (property: PropertyBuilder<string>) =>
            property.valueGeneratedOnAddOrUpdate()],
        ['computed', (property: PropertyBuilder<string>) =>
            property.hasComputedColumnSql('\'t2\'')],
    ] as const)('rejects a tenant property that is %s', (_label, configure) => {
        expect(() => generatedTenantModel(configure).build()).toThrow(
            'Tenant property \'GeneratedTenantRow.tenantId\' cannot be store-generated. ' +
            'Tenant identity must be supplied and verified before SQL execution.',
        );
    });

    it('rejects a store-generation strategy on a tenant primary key', () => {
        const model = new ModelBuilderImplementation()
            .entity(GeneratedTenantNumber, entity => {
                entity.toTable('generated_tenant_numbers');
                entity.hasKey(row => row.tenantId);
                entity.property(row => row.tenantId)
                    .hasColumnName('tenant_id').hasColumnType('integer')
                    .useAutoIncrement();
                entity.property(row => row.label).hasColumnType('text').isRequired();
                entity.tenantKey(row => row.tenantId);
            });

        expect(() => model.build()).toThrow(
            'Tenant property \'GeneratedTenantNumber.tenantId\' cannot be store-generated.',
        );
    });

    it('rejects a converter-backed generated tenant on a nested path', () => {
        const model = new ModelBuilderImplementation()
            .entity(NestedGeneratedTenantRow, entity => {
                entity.toTable('nested_generated_tenant_rows');
                entity.hasKey(row => row.id);
                entity.property(row => row.id).hasColumnType('text').isRequired();
                entity.complexProperty(
                    row => row.scope,
                    { constructor: GeneratedTenantScope },
                    scope => scope.property(value => value.tenantId)
                        .hasColumnName('tenant_id').hasColumnType('text')
                        .hasConversion(tenantConverter)
                        .valueGeneratedOnAdd(),
                );
                entity.tenantKey(row => row.scope.tenantId);
            });

        expect(() => model.build()).toThrow(
            'Tenant property \'NestedGeneratedTenantRow.scope.tenantId\' cannot be store-generated.',
        );
    });

    it('defensively rejects invalid metadata in tracked insert planning', () => {
        const metadata = invalidMetadata();
        const entity = Object.assign(new GeneratedTenantRow(), {
            id: 'row-one',
            tenantId: 't1',
            label: 'one',
        });
        const entry = new EntityEntry(entity, metadata, EntityState.Added);

        expect(() => buildInsertSavePlanEntry(
            new ModificationSqlBuilder(),
            [capturePersistedEntrySnapshot(
                entry as unknown as EntityEntry<object>,
            )],
        )).toThrow(
            'Tenant property \'GeneratedTenantRow.tenantId\' cannot be store-generated.',
        );
    });

    it('defensively rejects invalid metadata in upsert planning', () => {
        expect(() => upsertGeneratedProperties(invalidMetadata())).toThrow(
            'Tenant property \'GeneratedTenantRow.tenantId\' cannot be store-generated.',
        );
    });
});
