import type { EntityEntry } from './entity-entry';
import { EntityState } from './entity-state';
import { snapshotValuesEqual } from './snapshot-value-equality';
import {
    temporaryGeneratedIdentity,
    temporaryGeneratedProperty,
} from './temporary-generated-identity';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';

export type RelationshipTargetResolution =
    { readonly kind: 'none' | 'untracked' } |
    { readonly kind: 'stable'; readonly principal: EntityEntry<object> } |
    { readonly kind: 'temporary'; readonly principal: EntityEntry<object>;
        readonly identity: string };

export type RelationshipTargetCandidate = Exclude<
    RelationshipTargetResolution,
    { readonly kind: 'none' | 'untracked' }
>;

export function relationshipTargetCandidate(
    relationship: TrackedRelationshipMetadata,
    entry: EntityEntry<object>,
): RelationshipTargetCandidate {
    const properties = relationship.principalKeyProperties ??
        entry.metadata.keyProperties;
    const temporary = properties.some(property =>
        temporaryGeneratedProperty(entry, property) !== undefined)
        ? temporaryGeneratedIdentity(entry)
        : undefined;
    return temporary
        ? { kind: 'temporary', principal: entry, identity: temporary.identityKey }
        : { kind: 'stable', principal: entry };
}

export function selectRelationshipTarget(
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    bound: Readonly<Record<string, unknown>>,
    matches: readonly RelationshipTargetCandidate[],
): RelationshipTargetResolution {
    const unchanged = relationship.foreignKeyProperties.every(property =>
        snapshotValuesEqual(bound[property], dependent.originalBoundValues[property]));
    const eligible = dependent.state !== EntityState.Added && unchanged
        ? matches.filter(match => match.kind === 'stable')
        : matches;
    if (eligible.length > 1) {
        throw new Error(
            `Relationship '${dependent.metadata.entityName}.` +
            `${relationship.navigationProperty}' has an ambiguous FK-only ` +
            'target because more than one tracked principal has the same ' +
            'unresolved or persisted provider key. Set the principal ' +
            'navigation explicitly.',
        );
    }
    if (eligible.length === 0) return { kind: 'untracked' };
    const resolved = eligible[0];
    if (resolved.kind === 'temporary') {
        if (resolved.principal === dependent) {
            throw generatedSelfTarget(dependent, relationship);
        }
        if (dependent.state === EntityState.Added) {
            throw fkOnlyTemporaryTarget(dependent, relationship);
        }
        throw unresolvedTarget(dependent, resolved.principal, relationship);
    }
    return resolved;
}

export function assertTrackedTargetCanBeAssigned(
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    principal: EntityEntry<object>,
): void {
    const resolved = relationshipTargetCandidate(relationship, principal);
    if (resolved.kind !== 'temporary') return;
    if (principal === dependent) throw generatedSelfTarget(dependent, relationship);
    if (dependent.state !== EntityState.Added)
        throw unresolvedTarget(dependent, principal, relationship);
}

function fkOnlyTemporaryTarget(
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
): Error {
    return new Error(
        `Relationship '${dependent.metadata.entityName}.` +
        `${relationship.navigationProperty}' cannot infer a newly added ` +
        'principal from an unresolved store-generated FK value. Set the ' +
        `navigation '${relationship.navigationProperty}' explicitly.`,
    );
}

function generatedSelfTarget(
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
): Error {
    return new Error(
        `Relationship '${dependent.metadata.entityName}.` +
        `${relationship.navigationProperty}' cannot target the same newly ` +
        'added entity through an unresolved store-generated key.',
    );
}

function unresolvedTarget(
    dependent: EntityEntry<object>,
    principal: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
): Error {
    const properties = (relationship.principalKeyProperties ??
        principal.metadata.keyProperties).filter(property =>
        temporaryGeneratedProperty(principal, property) !== undefined);
    const key = properties.map(property =>
        `${principal.metadata.entityName}.${property}`).join(', ');
    return new Error(
        `Cannot assign existing '${dependent.metadata.entityName}' to newly ` +
        `added '${principal.metadata.entityName}' because the relationship ` +
        `key '${key}' has not been generated yet. Save the principal first, ` +
        'then assign the relationship.',
    );
}
