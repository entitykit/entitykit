import type { EntityPropertyKey } from '../types';
import type { EntityMetadata } from './entity-metadata';
import type { PropertyMetadata } from './property-metadata';
import { orderedEqual } from '../collections/ordered-equality';

interface PrincipalKeyRelationship<TPrincipal extends object> {
    readonly principalKeyProperties?:
    ReadonlyArray<EntityPropertyKey<TPrincipal>>;
}

/** Resolve the primary or alternate key tuple targeted by a relationship. */
export function relationshipPrincipalKeyProperties<
    TPrincipal extends object,
>(
    relationship: PrincipalKeyRelationship<TPrincipal>,
    principal: EntityMetadata<TPrincipal>,
): ReadonlyArray<EntityPropertyKey<TPrincipal>> {
    return relationship.principalKeyProperties?.map(property => property) ??
        principal.keyProperties;
}

export function relationshipPrincipalKeyMetadata<
    TPrincipal extends object,
>(
    relationship: PrincipalKeyRelationship<TPrincipal>,
    principal: EntityMetadata<TPrincipal>,
): ReadonlyArray<PropertyMetadata<TPrincipal>> {
    return relationshipPrincipalKeyProperties(relationship, principal)
        .map(property => principal.getProperty(property));
}

export function relationshipPrincipalKeyValues<
    TPrincipal extends object,
>(
    relationship: PrincipalKeyRelationship<TPrincipal>,
    principal: EntityMetadata<TPrincipal>,
    entity: TPrincipal,
): unknown[] {
    const values = entity as Record<string, unknown>;
    return relationshipPrincipalKeyProperties(relationship, principal)
        .map(property => values[property]);
}

export function isDeclaredPrincipalKey(
    principal: EntityMetadata,
    propertyNames: readonly string[],
): boolean {
    return orderedEqual(principal.keyProperties, propertyNames) ||
        principal.alternateKeys.some(key =>
            orderedEqual(key.propertyNames, propertyNames));
}
