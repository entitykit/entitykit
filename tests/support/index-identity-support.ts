import { ModelBuilder } from '../../packages/core/src/model/model-builder';
import type { Model } from '../../packages/core/src/model/model';
import { createModelSnapshot } from '../../packages/core/src/model/model-snapshot-serializer';
import type { ModelSnapshot } from '../../packages/core/src/model/model-snapshot-types';

class IndexedRecord {
    public id!: string; public userId!: string; public label!: string;
}

export function indexIdentityModel(names: readonly [string, string], equivalent = false): Model {
    return new ModelBuilder().entity(IndexedRecord, entity => {
        entity.toTable('indexed_records').hasKey(row => row.id);
        entity.property(row => row.id).hasColumnType('text').isRequired();
        entity.property(row => row.userId).hasColumnName('user_id').hasColumnType('text').isRequired();
        entity.property(row => row.label).hasColumnType('text').isRequired();
        entity.hasIndex(row => row.userId).isUnique().hasDatabaseName(names[0]);
        entity.hasIndex(equivalent ? [{ kind: 'property', propertyName: 'userId' }] : [
            { kind: 'property', propertyName: 'userId' }, { kind: 'expression', expression: 'lower(label)' },
        ]).isUnique().hasDatabaseName(names[1]);
    }).build();
}

export function caseCollidingSnapshot(original: ModelSnapshot, expressionFirst = false): ModelSnapshot {
    return { ...original, entities: original.entities.map(entity => {
        const index = entity.indexes.at(0);
        if (!index) return entity;
        const property = { kind: 'property', propertyName: index.propertyNames[0] } as const;
        const expression = { kind: 'expression', expression: 'lower(label)' } as const;
        const name = index.databaseName ?? `ux_${entity.tableName}_user_id`;
        return { ...entity, indexes: [...entity.indexes, { ...index, databaseName: name.toUpperCase(),
            keyParts: expressionFirst ? [expression, property] : [property, expression] }] };
    }) };
}

export function indexIdentitySnapshot(): ModelSnapshot {
    const original = createModelSnapshot(indexIdentityModel(['ux_indexed_records_user_id', 'ux_user_label']));
    return { ...original, entities: original.entities.map(entity => ({ ...entity, indexes: entity.indexes.slice(0, 1) })) };
}
