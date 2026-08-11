import type { EntityMetadata } from '../model/entity-metadata';
import type { RelationshipKeyMetadata } from '../model/relationship-key-codec';
import { boundQueryValue } from './expression/bound-query-value';
import type { IncludeLoadRoot } from './include-loader-context';

export function dependentBoundTuple(
    relationship: RelationshipKeyMetadata,
    root: IncludeLoadRoot,
): readonly unknown[] {
    return relationship.foreignKeyProperties.map(
        property => root.boundValues[property],
    );
}

export function principalBoundTuple<TEntity extends object>(
    relationship: RelationshipKeyMetadata,
    metadata: EntityMetadata<TEntity>,
    root: IncludeLoadRoot<TEntity>,
): readonly unknown[] {
    return (relationship.principalKeyProperties ?? metadata.keyProperties)
        .map(property => root.boundValues[property]);
}

export function boundQueryTuple(
    values: readonly unknown[],
): readonly unknown[] {
    return values.map(value => value === null || value === undefined
        ? value
        : boundQueryValue(value));
}
