import type {
    EntitySnapshot,
    RelationshipSnapshot,
} from '../model/model-snapshot-types';
import { foreignKeyConstraintName } from '../sql/identifiers';
import type { AddForeignKeyOperation, DropForeignKeyOperation, ModelDiffOperation } from './model-diff-operations';
import { entityKey, propertyColumn } from './model-diff-helpers';

/**
 * Foreign-key detection: add and drop operations for an entity's relationships.
 *
 * Separate because a foreign key is identified by a composite of dependent and
 * principal facts (both tables, both column sets, the constraint name, and the
 * delete behaviour). Resolving all of that — and defaulting the constraint name
 * to match `SchemaSqlBuilder` so a later migration drops the name that actually
 * exists — is a self-contained concern kept out of the other detectors.
 */
export function diffForeignKeys(
    from: EntitySnapshot,
    to: EntitySnapshot,
    fromEntitiesByName: ReadonlyMap<string, EntitySnapshot>,
    toEntitiesByName: ReadonlyMap<string, EntitySnapshot>,
): ModelDiffOperation[] {
    const operations: ModelDiffOperation[] = [];
    const fromRelationships = new Map(from.relationships.map(relationship => [foreignKeyKey(from, relationship, fromEntitiesByName), relationship]));
    const toRelationships = new Map(to.relationships.map(relationship => [foreignKeyKey(to, relationship, toEntitiesByName), relationship]));

    for (const relationship of from.relationships) {
        if (!toRelationships.has(foreignKeyKey(from, relationship, fromEntitiesByName))) {
            operations.push(dropForeignKeyOperation(from, relationship, fromEntitiesByName));
        }
    }

    for (const relationship of to.relationships) {
        if (!fromRelationships.has(foreignKeyKey(to, relationship, toEntitiesByName))) {
            operations.push(createForeignKeyOperation(to, relationship, toEntitiesByName));
        }
    }

    return operations;
}

export function createForeignKeyOperation(
    entity: EntitySnapshot,
    relationship: RelationshipSnapshot,
    entitiesByName: ReadonlyMap<string, EntitySnapshot>,
): AddForeignKeyOperation {
    const principal = entitiesByName.get(relationship.principalEntityName);
    if (!principal) {
        throw new Error(`Relationship '${relationship.navigationProperty}' on entity '${entity.entityName}' references missing principal entity '${relationship.principalEntityName}'.`);
    }

    return {
        kind: 'addForeignKey',
        entityName: entity.entityName,
        tableName: entity.tableName,
        schemaName: entity.schemaName,
        name: resolvedForeignKeyName(entity, relationship, principal.tableName),
        columns: foreignKeyProperties(relationship).map(propertyName => propertyColumn(entity, propertyName)),
        principalTableName: principal.tableName,
        principalSchemaName: principal.schemaName,
        principalColumns: principalKeyProperties(relationship, principal)
            .map(propertyName => propertyColumn(principal, propertyName)),
        onDelete: relationship.deleteBehavior,
    };
}

export function dropForeignKeyOperation(
    entity: EntitySnapshot,
    relationship: RelationshipSnapshot,
    entitiesByName: ReadonlyMap<string, EntitySnapshot>,
): DropForeignKeyOperation {
    const operation = createForeignKeyOperation(entity, relationship, entitiesByName);
    return { ...operation, kind: 'dropForeignKey' };
}

function foreignKeyKey(
    entity: EntitySnapshot,
    relationship: RelationshipSnapshot,
    entitiesByName: ReadonlyMap<string, EntitySnapshot>,
): string {
    const principal = entitiesByName.get(relationship.principalEntityName);
    const principalTable = principal ? entityKey(principal) : relationship.principalEntityName;
    const dependentColumn = foreignKeyProperties(relationship).map(propertyName => propertyColumn(entity, propertyName)).join(',');
    const principalColumn = principal
        ? principalKeyProperties(relationship, principal)
            .map(propertyName => propertyColumn(principal, propertyName))
            .join(',')
        : '';
    return [
        entityKey(entity),
        resolvedForeignKeyName(
            entity,
            relationship,
            principal?.tableName ?? relationship.principalEntityName,
        ),
        dependentColumn,
        principalTable,
        principalColumn,
        relationship.deleteBehavior,
    ].join(':');
}

/**
 * The default foreign-key name, matching `SchemaSqlBuilder` — the schema builder
 * creates the constraint, so the migration differ must reference it by the same
 * name (`fk_<child>_<principal>_<columns>`) or a later migration would try to
 * drop a constraint that does not exist under the name it computed.
 */
function resolvedForeignKeyName(entity: EntitySnapshot, relationship: RelationshipSnapshot, principalTable: string): string {
    return foreignKeyConstraintName(
        relationship.constraintName,
        entity.tableName,
        principalTable,
        foreignKeyProperties(relationship).map(propertyName =>
            propertyColumn(entity, propertyName)),
    );
}

/** Foreign key property names, tolerating snapshots written before composite keys. */
function foreignKeyProperties(relationship: RelationshipSnapshot): readonly string[] {
    return relationship.foreignKeyProperties
    ?? (relationship.foreignKeyProperty ? [relationship.foreignKeyProperty] : []);
}

/** Key property names, tolerating snapshots written before composite keys. */
function keyProperties(entity: EntitySnapshot): readonly string[] {
    return entity.keyProperties ?? (entity.keyProperty ? [entity.keyProperty] : []);
}

function principalKeyProperties(
    relationship: RelationshipSnapshot,
    principal: EntitySnapshot,
): readonly string[] {
    return relationship.principalKeyProperties ?? keyProperties(principal);
}
