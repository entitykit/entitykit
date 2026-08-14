import type { EntityEntry } from './entity-entry';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';

export interface ActiveGeneratedRelationshipTarget {
    readonly kind: 'active';
    readonly principal: EntityEntry<object>;
    currentExpectedProviderValues: readonly unknown[];
    currentValueIsFrameworkOwned: boolean;
}

export interface InvalidGeneratedRelationshipTarget {
    readonly kind: 'invalid';
    readonly currentExpectedProviderValues: readonly unknown[];
    readonly currentValueIsFrameworkOwned: boolean;
}

export type GeneratedRelationshipTarget =
    ActiveGeneratedRelationshipTarget | InvalidGeneratedRelationshipTarget;

interface TargetLink {
    readonly dependent: EntityEntry<object>;
    readonly relationship: TrackedRelationshipMetadata;
}

const targets: WeakMap<
    EntityEntry<object>,
    Map<TrackedRelationshipMetadata, GeneratedRelationshipTarget>
> = new WeakMap();
const linksByPrincipal: WeakMap<
    EntityEntry<object>, Set<TargetLink>
> = new WeakMap();

export function generatedRelationshipTarget(
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
): GeneratedRelationshipTarget | undefined {
    return targets.get(dependent)?.get(relationship);
}

export function storeGeneratedRelationshipTarget(
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
    target: ActiveGeneratedRelationshipTarget,
): void {
    deleteGeneratedRelationshipTarget(dependent, relationship);
    const byRelationship = targets.get(dependent) ?? new Map<
        TrackedRelationshipMetadata, GeneratedRelationshipTarget
    >();
    byRelationship.set(relationship, target);
    targets.set(dependent, byRelationship);
    const links = linksByPrincipal.get(target.principal) ??
        new Set<TargetLink>();
    links.add({ dependent, relationship });
    linksByPrincipal.set(target.principal, links);
}

export function deleteGeneratedRelationshipTarget(
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
): void {
    const byRelationship = targets.get(dependent);
    const target = byRelationship?.get(relationship);
    if (!target) return;
    byRelationship?.delete(relationship);
    if (byRelationship?.size === 0) targets.delete(dependent);
    if (target.kind === 'active') {
        removePrincipalLink(target.principal, dependent, relationship);
    }
}

/** Remove dependent state and fail closed for a detached principal target. */
export function detachGeneratedRelationshipTargets(
    entry: EntityEntry<object>,
): void {
    deleteDependentTargets(entry);
    const links = [...linksByPrincipal.get(entry) ?? []];
    linksByPrincipal.delete(entry);
    for (const { dependent, relationship } of links) {
        const current = generatedRelationshipTarget(dependent, relationship);
        if (current?.kind !== 'active' || current.principal !== entry) continue;
        targets.get(dependent)?.set(relationship, {
            kind: 'invalid',
            currentExpectedProviderValues:
                current.currentExpectedProviderValues,
            currentValueIsFrameworkOwned:
                current.currentValueIsFrameworkOwned,
        });
    }
}

/** Discard provenance made durable by a successful acceptance. */
export function acceptGeneratedRelationshipTargets(
    entry: EntityEntry<object>,
): void {
    deleteDependentTargets(entry);
    for (const link of [...linksByPrincipal.get(entry) ?? []]) {
        deleteGeneratedRelationshipTarget(
            link.dependent, link.relationship,
        );
    }
    linksByPrincipal.delete(entry);
}

function deleteDependentTargets(entry: EntityEntry<object>): void {
    for (const relationship of [...targets.get(entry)?.keys() ?? []]) {
        deleteGeneratedRelationshipTarget(entry, relationship);
    }
}

function removePrincipalLink(
    principal: EntityEntry<object>,
    dependent: EntityEntry<object>,
    relationship: TrackedRelationshipMetadata,
): void {
    const links = linksByPrincipal.get(principal);
    if (!links) return;
    for (const link of links) {
        if (link.dependent === dependent &&
            link.relationship === relationship) links.delete(link);
    }
    if (links.size === 0) linksByPrincipal.delete(principal);
}
