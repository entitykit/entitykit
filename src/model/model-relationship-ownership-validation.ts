import {
    foreignKeyConstraintName,
} from '../relational-identifiers';
import type { EntityConstructor } from '../types';
import type { EntityMetadata } from './entity-metadata';

/** Require one relationship owner per dependent FK and provider identifier. */
export function validateModelRelationshipOwnership(
    entities: readonly EntityMetadata[],
    entitiesByConstructor: ReadonlyMap<
        EntityConstructor<object>, EntityMetadata
    >,
): void {
    for (const entity of entities) {
        const tuples: Map<string, string> = new Map();
        const constraintNames: Map<string, string> = new Map();
        for (const relationship of entity.relationships) {
            const navigation = String(relationship.navigationProperty);
            const tuple = relationship.foreignKeyProperties
                .map(String).join('\0');
            const previousTuple = tuples.get(tuple);
            if (previousTuple) {
                throw new Error(
                    `Foreign-key properties (${relationship.foreignKeyProperties
                        .map(String).join(', ')}) on entity ` +
                    `'${entity.entityName}' are claimed by more than one ` +
                    `relationship: '${previousTuple}' and '${navigation}'.`,
                );
            }
            tuples.set(tuple, navigation);
            const principal = entitiesByConstructor.get(
                relationship.principalEntity,
            );
            if (!principal) continue;
            const name = foreignKeyConstraintName(
                relationship.constraintName,
                entity.tableName,
                principal.tableName,
                relationship.foreignKeyProperties.map(property =>
                    entity.getProperty(String(property)).columnName),
            );
            const previousConstraint = constraintNames.get(name);
            if (previousConstraint) {
                throw new Error(
                    `Foreign-key constraint identifier '${name}' on table ` +
                    `'${entity.tableName}' is claimed by relationships ` +
                    `'${previousConstraint}' and '${navigation}'.`,
                );
            }
            constraintNames.set(name, navigation);
        }
    }
}
