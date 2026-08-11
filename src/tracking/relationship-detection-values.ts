import type { EntityEntry } from './entity-entry';

/** Scalar values captured once for one relationship-detection generation. */
export type RelationshipDetectionValues = ReadonlyMap<
    EntityEntry<object>,
    Record<string, unknown>
>;

/** Use generation values when supplied, otherwise read the live entity. */
export function relationshipValuesFor(
    entry: EntityEntry<object>,
    captured?: RelationshipDetectionValues,
): Record<string, unknown> {
    return captured?.get(entry) ??
        entry.entity as Record<string, unknown>;
}
