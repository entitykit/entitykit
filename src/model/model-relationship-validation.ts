import type { EntityConstructor } from '../types';
import type { EntityMetadata } from './entity-metadata';
import { isDeclaredPrincipalKey } from './relationship-key';
import { DeleteBehavior } from './relationship-metadata';

export function validateModelRelationships(
    entities: readonly EntityMetadata[],
    entitiesByConstructor: ReadonlyMap<
        EntityConstructor<object>,
        EntityMetadata
    >,
): void {
    for (const entity of entities) {
        if (
            entity.isKeyless &&
            entity.manyToManyRelationships.length > 0
        ) {
            throw new Error(`Keyless entity '${entity.entityName}' cannot configure many-to-many relationships.`);
        }
        for (const relationship of entity.relationships) {
            const principal = entitiesByConstructor.get(
                relationship.principalEntity,
            );
            if (!principal) {
                throw new Error(
                    `Relationship '${String(relationship.navigationProperty)}' on entity '${entity.entityName}' references unregistered principal entity '${relationship.principalEntity.name}'.`,
                );
            }
            if (principal.isKeyless) {
                throw new Error(
                    `Relationship '${String(relationship.navigationProperty)}' on entity '${entity.entityName}' cannot target keyless principal '${principal.entityName}'.`,
                );
            }
            const principalKey = relationship.principalKeyProperties ??
                principal.keyProperties;
            if (!isDeclaredPrincipalKey(principal, principalKey)) {
                throw new Error(
                    `Relationship '${String(relationship.navigationProperty)}' on entity '${entity.entityName}' targets (${principalKey.join(', ')}), which is not the primary key or a declared alternate key of '${principal.entityName}'.`,
                );
            }
            if (
                relationship.foreignKeyProperties.length !==
                principalKey.length
            ) {
                const foreignKeyCount =
                    relationship.foreignKeyProperties.length;
                throw new Error(
                    `Relationship '${String(relationship.navigationProperty)}' on entity '${entity.entityName}' declares ${String(foreignKeyCount)} foreign-key ${foreignKeyCount === 1 ? 'property' : 'properties'}, but its principal key has ${String(principalKey.length)} properties.`,
                );
            }
            if (
                relationship.deleteBehavior === DeleteBehavior.SetNull &&
                relationship.foreignKeyProperties.some(property =>
                    entity.getProperty(property).isRequired)
            ) {
                throw new Error(
                    `Relationship '${String(relationship.navigationProperty)}' on entity '${entity.entityName}' uses SetNull, but every foreign-key property must be optional.`,
                );
            }
        }

        for (const relationship of entity.manyToManyRelationships) {
            const target = entitiesByConstructor.get(relationship.targetEntity);
            if (!target) {
                throw new Error(
                    `Many-to-many relationship '${String(relationship.navigationProperty)}' on entity '${entity.entityName}' references unregistered target entity '${relationship.targetEntity.name}'.`,
                );
            }
            if (target.isKeyless) {
                throw new Error(
                    `Many-to-many relationship '${String(relationship.navigationProperty)}' on entity '${entity.entityName}' cannot target keyless entity '${target.entityName}'.`,
                );
            }
            if (
                relationship.targetForeignKeyColumns.length !==
                target.keyProperties.length
            ) {
                throw new Error(
                    `Many-to-many relationship '${String(relationship.navigationProperty)}' on entity '${entity.entityName}' declares ${String(relationship.targetForeignKeyColumns.length)} target foreign-key column(s), but '${target.entityName}' has ${String(target.keyProperties.length)} key column(s).`,
                );
            }
            const allJoinColumns = [
                ...relationship.sourceForeignKeyColumns,
                ...relationship.targetForeignKeyColumns,
            ];
            const duplicate = allJoinColumns.find(
                (column, index) => allJoinColumns.indexOf(column) !== index,
            );
            if (duplicate) {
                throw new Error(
                    `Many-to-many relationship '${String(relationship.navigationProperty)}' on entity '${entity.entityName}' uses join column '${duplicate}' more than once.`,
                );
            }
        }
    }
}
