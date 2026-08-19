import type {
    EntitySnapshot,
    ManyToManySnapshot,
    PropertySnapshot,
} from '../model/model-snapshot-types';

export interface JoinTableSide {
    readonly keys: readonly PropertySnapshot[];
    readonly columns: readonly string[];
}

export function resolveJoinTableSide(
    entity: EntitySnapshot,
    relationship: ManyToManySnapshot,
    side: 'source' | 'target',
): JoinTableSide {
    const keyNames = entity.keyProperties ??
        (entity.keyProperty ? [entity.keyProperty] : []);
    if (keyNames.length === 0) {
        throw new Error(
            `Entity '${entity.entityName}' is keyless and cannot participate in a many-to-many join table.`,
        );
    }
    const keys = keyNames.map(name => propertySnapshot(entity, name));
    const columns = joinColumns(relationship, side);
    if (columns.length !== keys.length) {
        throw new Error(
            `Many-to-many join table '${relationship.joinTableName}' declares ${String(columns.length)} ${side} foreign-key column(s), but '${entity.entityName}' has ${String(keys.length)} key column(s).`,
        );
    }
    return { keys, columns };
}

export function assertDistinctJoinColumns(
    relationship: ManyToManySnapshot,
    columns: readonly string[],
): void {
    const duplicate = columns.find(
        (column, index) => columns.indexOf(column) !== index,
    );
    if (duplicate) {
        throw new Error(
            `Many-to-many join table '${relationship.joinTableName}' uses column '${duplicate}' on both sides of the relationship.`,
        );
    }
}

function propertySnapshot(
    entity: EntitySnapshot,
    propertyName: string,
): PropertySnapshot {
    const property = entity.properties.find(
        item => item.propertyName === propertyName,
    );
    if (!property) {
        throw new Error(
            `Entity '${entity.entityName}' references missing property '${propertyName}'.`,
        );
    }
    return property;
}

function joinColumns(
    relationship: ManyToManySnapshot,
    side: 'source' | 'target',
): readonly string[] {
    const columns = side === 'source'
        ? relationship.sourceForeignKeyColumns ??
            (relationship.sourceForeignKeyColumn
                ? [relationship.sourceForeignKeyColumn]
                : [])
        : relationship.targetForeignKeyColumns ??
            (relationship.targetForeignKeyColumn
                ? [relationship.targetForeignKeyColumn]
                : []);
    if (columns.length === 0) {
        throw new Error(
            `Many-to-many join table '${relationship.joinTableName}' has no ${side} foreign-key columns.`,
        );
    }
    return columns;
}
