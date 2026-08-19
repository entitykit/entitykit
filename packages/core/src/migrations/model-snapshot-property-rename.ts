import type {
    EntitySnapshot,
    ModelSnapshot,
    PropertySnapshot,
    RelationshipSnapshot,
} from '../model/model-snapshot-types';
import { defaultIndexName } from './model-diff-helpers';

/** Follow a renamed mapped property through every snapshot reference to it. */
export function renameSnapshotProperty(
    snapshot: ModelSnapshot,
    entity: EntitySnapshot,
    property: PropertySnapshot,
    targetProperty: PropertySnapshot,
): ModelSnapshot {
    const from = property.propertyName;
    const to = targetProperty.propertyName;
    return {
        ...snapshot,
        entities: snapshot.entities.map(candidate => ({
            ...candidate,
            ...candidate === entity
                ? renameOwnedReferences(candidate, property, targetProperty)
                : {},
            relationships: candidate.relationships.map(relationship =>
                renameRelationshipReferences(
                    relationship,
                    candidate === entity ? from : undefined,
                    relationship.principalEntityName === entity.entityName
                        ? to
                        : undefined,
                    from,
                )),
        })),
    };
}

function renameOwnedReferences(
    entity: EntitySnapshot,
    property: PropertySnapshot,
    targetProperty: PropertySnapshot,
): Partial<EntitySnapshot> {
    const from = property.propertyName;
    const to = targetProperty.propertyName;
    return {
        keyProperty: entity.keyProperty === from ? to : entity.keyProperty,
        keyProperties: renameNames(entity.keyProperties, from, to),
        properties: entity.properties.map(candidate =>
            candidate === property
                ? { ...candidate, columnName: targetProperty.columnName, propertyName: to }
                : candidate),
        alternateKeys: entity.alternateKeys?.map(key => ({
            ...key,
            propertyNames: renameNames(key.propertyNames, from, to) ?? [],
        })),
        indexes: entity.indexes.map(index => ({
            ...index,
            databaseName: index.propertyNames.includes(from)
                ? index.databaseName ?? defaultIndexName(entity, index)
                : index.databaseName,
            propertyNames: renameNames(index.propertyNames, from, to) ?? [],
            keyParts: index.keyParts?.map(part =>
                part.kind === 'property' && part.propertyName === from
                    ? { ...part, propertyName: to }
                    : part),
            includedPropertyNames: renameNames(
                index.includedPropertyNames,
                from,
                to,
            ),
        })),
        audit: entity.audit && mapObjectValues(entity.audit, from, to),
        softDelete: entity.softDelete && {
            ...entity.softDelete,
            propertyName: entity.softDelete.propertyName === from
                ? to
                : entity.softDelete.propertyName,
        },
        tenantKeyProperty: entity.tenantKeyProperty === from
            ? to
            : entity.tenantKeyProperty,
    };
}

function renameRelationshipReferences(
    relationship: RelationshipSnapshot,
    dependentTo: string | undefined,
    principalTo: string | undefined,
    from: string,
): RelationshipSnapshot {
    return {
        ...relationship,
        foreignKeyProperty:
            dependentTo && relationship.foreignKeyProperty === from
                ? dependentTo
                : relationship.foreignKeyProperty,
        foreignKeyProperties: dependentTo
            ? renameNames(relationship.foreignKeyProperties, from, dependentTo)
            : relationship.foreignKeyProperties,
        principalKeyProperties: principalTo
            ? renameNames(relationship.principalKeyProperties, from, principalTo)
            : relationship.principalKeyProperties,
    };
}

function renameNames(
    names: readonly string[] | undefined,
    from: string,
    to: string,
): readonly string[] | undefined {
    return names?.map(name => name === from ? to : name);
}

function mapObjectValues<T extends object>(value: T, from: string, to: string): T {
    return Object.fromEntries(
        Object.entries(value).map(([key, candidate]) => [
            key,
            candidate === from ? to : candidate,
        ]),
    ) as T;
}
