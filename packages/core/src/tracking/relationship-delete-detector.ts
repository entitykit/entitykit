import type { Model } from '../model/model';
import { DeleteBehavior } from '../model/relationship-metadata';
import type { ChangeTracker } from './change-tracker';
import { EntityState } from './entity-state';
import {
    cascadeDeleteDependent,
    severDependent,
} from './relationship-fixup';
import { relationshipConnects } from './relationship-resolution';
import type { RelationshipDetectionValues } from './relationship-detection-values';
import { TrackedCascadeGraph } from './tracked-cascade-graph';
import type { EntityEntry } from './entity-entry';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';

/** Apply configured delete behavior to dependents already tracked in memory. */
export function detectTrackedCascades(
    tracker: ChangeTracker,
    model: Model,
    captured: RelationshipDetectionValues,
): void {
    const entries = tracker.entries();
    const pending = entries.filter(entry => entry.state === EntityState.Deleted);
    if (pending.length === 0) return;
    const graph = new TrackedCascadeGraph(tracker, model, entries, captured);
    for (const principal of pending) {
        if (principal.state !== EntityState.Deleted) continue;
        const dependents: Map<EntityEntry<object>, TrackedRelationshipMetadata[]> = new Map();
        for (const { dependent, relationship } of graph.dependentsOf(principal)) {
            const relationships = dependents.get(dependent) ?? [];
            relationships.push(relationship);
            dependents.set(dependent, relationships);
        }
        for (const [dependent, relationships] of dependents) {
            if (
                dependent.state === EntityState.Deleted ||
                dependent.state === EntityState.Detached
            ) continue;
            for (const relationship of relationships) {
                if (!relationshipConnects(tracker, model, dependent, relationship, principal, captured)) continue;
                if (relationship.deleteBehavior === DeleteBehavior.Cascade) {
                    cascadeDeleteDependent(tracker, dependent, relationship, principal.entity);
                } else if (relationship.deleteBehavior === DeleteBehavior.SetNull) {
                    severDependent(tracker, dependent, relationship, principal.entity, captured);
                }
            }
            if ((dependent.state as EntityState) === EntityState.Deleted) pending.push(dependent);
        }
    }
}
