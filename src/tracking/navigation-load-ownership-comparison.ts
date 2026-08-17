import type { EntityMetadata } from '../model/entity-metadata';
import { readPropertyPath } from '../model/property-value-access';
import {
    relationshipDetectionIdentityKey as registeredIdentityKey,
} from './change-tracker-relationship-detection-registry';
import type { ChangeTracker } from './change-tracker';
import type { EntityEntry } from './entity-entry';
import { isChangeDetectedProperty } from './entity-entry-snapshot';
import type { OwnedEntryCheckpoint } from './navigation-load-ownership-checkpoint';
import { ownedNavigationFactsMatch } from './navigation-load-ownership-facts';
import { snapshotPropertyValuesEqual } from './snapshot-value';
import { snapshotValuesEqual } from './snapshot-value-equality';

/**
 * Whether an owned entry still stands exactly as its load registered it.
 *
 * The comparison is read-only by contract. Running `detectChanges()` here would
 * be the obvious shortcut and is forbidden: it mutates tracker state during a
 * rollback, runs arbitrary application accessors as a side effect, and still
 * cannot see an edit that was already accepted back to Unchanged.
 *
 * Every fact of the checkpoint has to match. The load's own mutations to an
 * owned entry -- its stitched navigations, the loaded flags and baselines it
 * moved -- are unwound by the graph-write journal and the per-property
 * participation checkpoints that run before this, so an application that never
 * touched the entity compares clean and is detached; only outside work survives
 * to differ. Reads may throw (a hostile getter, a converter that refuses a
 * value it once produced); an unreadable fingerprint is not a matching one, and
 * the caller turns that into the same refusal a mismatch produces.
 *
 * Mapped values compare in *provider* space -- the same space the save plan
 * writes in. Both sides go through the property's own converter and what comes
 * out is compared, so a converter collapsing two distinct model values onto one
 * provider fact hides exactly the edits no save would persist: a difference this
 * cannot see is a difference no UPDATE would carry. That is the point, and why a
 * value object whose state is private compares by what it converts to rather
 * than by a walk that cannot reach it.
 *
 * It does ask one thing of a converter that change detection does not. Change
 * detection compares a live value against a snapshot that same converter just
 * produced; this compares one against a pre-image materialization and
 * snapshotting have already round-tripped, so the added contract is
 * `toProvider ∘ fromProvider ∘ toProvider` ≡ `toProvider`. A converter unstable
 * across that round trip reports a difference nobody made, and rollback refuses
 * a detach it could have completed -- the safe direction, named rather than
 * silent.
 */
export function ownedEntryMatchesCheckpoint(
    tracker: ChangeTracker,
    entry: EntityEntry<object>,
    checkpoint: OwnedEntryCheckpoint,
): boolean {
    return entry.state === checkpoint.state
        && registeredIdentityKey(tracker, entry) === checkpoint.identityKey
        // The live entity against what materialization wrote onto it, then the
        // entry's baseline against the same pre-image: the first sees an edit
        // no detection pass has looked at, the second sees an acceptance that
        // moved the baseline out from under one.
        && valuesMatch(
            entry.metadata, entry.currentValues(), checkpoint.originalValues,
        )
        && valuesMatch(
            entry.metadata, entry.originalValues, checkpoint.originalValues,
        )
        && boundValuesMatch(
            entry.metadata,
            entry.originalBoundValues,
            checkpoint.originalBoundValues,
        )
        && complexValuesMatch(entry, checkpoint)
        && ownedNavigationFactsMatch(entry, checkpoint);
}

/** Compare model-space values through each property's own converter. */
function valuesMatch(
    metadata: EntityMetadata,
    current: Readonly<Record<string, unknown>>,
    captured: Readonly<Record<string, unknown>>,
): boolean {
    // The baseline object the entry still holds is the one that was captured
    // until something replaces it, and no converter can improve on that.
    return current === captured ||
        comparedKeys(metadata, current, captured).every(key =>
            snapshotPropertyValuesEqual(
                current[key],
                captured[key],
                metadata.tryGetProperty(key)?.converter,
                `${metadata.entityName}.${key}`,
            ));
}

/** Bound values are already provider facts, so they compare structurally. */
function boundValuesMatch(
    metadata: EntityMetadata,
    current: Readonly<Record<string, unknown>>,
    captured: Readonly<Record<string, unknown>>,
): boolean {
    return comparedKeys(metadata, current, captured).every(key =>
        snapshotValuesEqual(current[key], captured[key]));
}

/**
 * Complex containers compare by identity; their leaves compare as values.
 *
 * A replaced container is outside work even when it carries identical leaves,
 * and a container mutated in place keeps its identity but moves the mapped
 * values `valuesMatch` reads through the same property paths -- the leaves of a
 * complex property are ordinary mapped properties under a dotted path.
 */
function complexValuesMatch(
    entry: EntityEntry<object>,
    checkpoint: OwnedEntryCheckpoint,
): boolean {
    return entry.metadata.complexProperties.every(complex => Object.is(
        readPropertyPath(entry.entity, complex.propertyPath),
        checkpoint.complex.get(complex.propertyName),
    ));
}

/**
 * Every key either side knows about that a difference could be durable work in.
 *
 * The union, so an added key is a difference -- minus the properties change
 * detection refuses to judge. `isChangeDetectedProperty` is the rule keeping a
 * `valueGeneratedOnAddOrUpdate` column out of `modifiedProperties()`, out of an
 * entry's Modified verdict, and out of the columns an UPDATE carries. Assigning
 * one mid-load leaves the entry Unchanged with nothing modified -- EntityKit's
 * own verdict that no durable work exists -- and a fingerprint calling it a
 * difference anyway refuses a detach and poisons a context over work no save
 * could have written.
 *
 * The skip covers both value legs and the bound values with them. The other two
 * watch for a baseline *replaced* out from under the pre-image, and the
 * acceptance that replaces it moves every property at once: judging store-owned
 * ones differently there refuses the same detach by a second route.
 */
function comparedKeys(
    metadata: EntityMetadata,
    left: Readonly<Record<string, unknown>>,
    right: Readonly<Record<string, unknown>>,
): string[] {
    // A key no property claims is not the store's to own, so it stays judged:
    // an unmapped key on either side is still a difference.
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].filter(
        key => {
            const property = metadata.tryGetProperty(key);
            return property === undefined || isChangeDetectedProperty(property);
        });
}
