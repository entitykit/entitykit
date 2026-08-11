import { valueConverter } from '../src';
import { createQueryFilterOperation } from '../src/core/query-filter-operation';
import type { EntityMetadata } from '../src/model/entity-metadata';
import { ModelBuilder } from '../src/model/model-builder';
import { createQueryModel } from '../src/query/query-model';

interface JsonTenant {
    region: string;
}

class JsonParentTenantRow {
    public id = '';
    public tenantId!: JsonTenant;
}

class JsonChildTenantRow {
    public id = '';
    public tenantId!: JsonTenant;
}

interface BinaryTenant {
    bytes: Uint8Array;
}

class BinaryParentTenantRow {
    public id = '';
    public tenantId!: BinaryTenant;
}

class BinaryChildTenantRow {
    public id = '';
    public tenantId!: BinaryTenant;
}

function jsonTenantMetadata(): readonly [
    EntityMetadata<JsonParentTenantRow>,
    EntityMetadata<JsonChildTenantRow>,
] {
    const model = new ModelBuilder();
    model.entity(JsonParentTenantRow, entity => {
        entity.toTable('query_snapshot_json_parents');
        entity.hasKey(row => row.id);
        entity.tenantKey(row => row.tenantId);
        entity.property(row => row.id).hasColumnType('text').isRequired();
        entity.property(row => row.tenantId).hasColumnName('tenant_id')
            .hasColumnType('json').isRequired();
    });
    model.entity(JsonChildTenantRow, entity => {
        entity.toTable('query_snapshot_json_children');
        entity.hasKey(row => row.id);
        entity.tenantKey(row => row.tenantId);
        entity.property(row => row.id).hasColumnType('text').isRequired();
        entity.property(row => row.tenantId).hasColumnName('tenant_id')
            .hasColumnType('json').isRequired();
    });
    const built = model.build();
    return [
        built.getEntity(JsonParentTenantRow),
        built.getEntity(JsonChildTenantRow),
    ];
}

function binaryTenantMetadata(): readonly [
    EntityMetadata<BinaryParentTenantRow>,
    EntityMetadata<BinaryChildTenantRow>,
] {
    const converter = valueConverter<BinaryTenant, Uint8Array>({
        toProvider: value => value.bytes,
        fromProvider: value => ({ bytes: value }),
    });
    const model = new ModelBuilder();
    model.entity(BinaryParentTenantRow, entity => {
        entity.toTable('query_snapshot_binary_parents');
        entity.hasKey(row => row.id);
        entity.tenantKey(row => row.tenantId);
        entity.property(row => row.id).hasColumnType('text').isRequired();
        entity.property(row => row.tenantId).hasColumnName('tenant_id')
            .hasColumnType('blob').hasConversion(converter).isRequired();
    });
    model.entity(BinaryChildTenantRow, entity => {
        entity.toTable('query_snapshot_binary_children');
        entity.hasKey(row => row.id);
        entity.tenantKey(row => row.tenantId);
        entity.property(row => row.id).hasColumnType('text').isRequired();
        entity.property(row => row.tenantId).hasColumnName('tenant_id')
            .hasColumnType('blob').hasConversion(converter).isRequired();
    });
    const built = model.build();
    return [
        built.getEntity(BinaryParentTenantRow),
        built.getEntity(BinaryChildTenantRow),
    ];
}

function captureOperationValues<TParent extends object, TChild extends object>(
    currentTenant: () => unknown,
    metadata: readonly [EntityMetadata<TParent>, EntityMetadata<TChild>],
    mutate: () => void,
): unknown[] {
    const captured: unknown[] = [];
    const operation = createQueryFilterOperation(
        currentTenant,
        false,
        (_resolveTenant, resolveBoundTenant, entity, query) => {
            const bound = resolveBoundTenant(entity) as { readonly value: unknown };
            captured.push(bound.value);
            return query;
        },
    );
    operation.apply(metadata[0], createQueryModel(metadata[0].ctor));
    mutate();
    operation.apply(metadata[1], createQueryModel(metadata[1].ctor));
    return captured;
}

describe('query operation provider snapshots', () => {
    it('serializes a converter-free JSON tenant once', () => {
        const tenant: JsonTenant = { region: 'north' };

        const captured = captureOperationValues(
            () => tenant,
            jsonTenantMetadata(),
            () => {
                tenant.region = 'south';
            },
        );

        expect(captured).toEqual([
            '{"region":"north"}',
            '{"region":"north"}',
        ]);
    });

    it('clones a mutable converter result before caching it', () => {
        const tenant: BinaryTenant = { bytes: Uint8Array.from([1]) };

        const captured = captureOperationValues(
            () => tenant,
            binaryTenantMetadata(),
            () => {
                tenant.bytes[0] = 2;
            },
        );

        expect(captured).toEqual([
            Uint8Array.from([1]),
            Uint8Array.from([1]),
        ]);
    });
});
