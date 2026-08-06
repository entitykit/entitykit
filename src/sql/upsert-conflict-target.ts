import type { EntityMetadata } from '../model/entity-metadata';
import type { PropertyMetadata } from '../model/property-metadata';
import type { EntityPropertyKey } from '../types';
import type { SqlDialect } from './sql-dialect';

export function validateUpsertConflictTarget<TEntity extends object>(
    dialect: SqlDialect,
    metadata: EntityMetadata<TEntity>,
    conflictProperties: ReadonlyArray<PropertyMetadata<TEntity>>,
    tenantMatchProperty?: EntityPropertyKey<TEntity>,
): void {
    if (dialect.upsertConflictTarget !== 'anyUnique') {
        return;
    }

    const conflictNames = conflictProperties.map(property =>
        property.propertyName as EntityPropertyKey<TEntity>);
    if (!samePropertySet(conflictNames, metadata.keyProperties)) {
        throw new Error(
            `The '${dialect.name}' dialect cannot target upsert conflict properties on '${metadata.entityName}': ` +
      'its upsert clause fires for any primary or unique key. Use the primary key on a model without ' +
      'secondary unique keys, or use provider-specific SQL.',
        );
    }

    const secondaryUniqueIndex = metadata.indexes.find(index =>
        index.isUnique && !samePropertySet(index.propertyNames, metadata.keyProperties),
    );
    if (secondaryUniqueIndex) {
        throw new Error(
            `The '${dialect.name}' dialect cannot safely upsert '${metadata.entityName}' because the model has ` +
      `a secondary unique key on (${secondaryUniqueIndex.propertyNames.join(', ')}): its upsert clause may ` +
      'update that row instead of the primary-key row. Use provider-specific SQL.',
        );
    }
    if (tenantMatchProperty && !conflictNames.includes(tenantMatchProperty)) {
        throw new Error(
            `The '${dialect.name}' dialect cannot safely tenant-scope upsert on '${metadata.entityName}': ` +
            `tenant property '${tenantMatchProperty}' must be part of its primary-key conflict target.`,
        );
    }
}

function samePropertySet<TEntity extends object>(
    left: ReadonlyArray<EntityPropertyKey<TEntity>>,
    right: ReadonlyArray<EntityPropertyKey<TEntity>>,
): boolean {
    return left.length === right.length && left.every(property => right.includes(property));
}
