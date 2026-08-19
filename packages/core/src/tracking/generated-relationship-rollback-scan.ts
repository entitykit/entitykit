import type { ChangeTracker } from './change-tracker';
import type { GeneratedIdentityRollbackSource } from './generated-identity-rollback-source';
import {
    captureRelationshipDetectionValues,
    relationshipBoundValuesFor,
} from './relationship-detection-values';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';
import { EntityState } from './entity-state';
import { prepareGeneratedRelationshipRollbackAction } from './generated-relationship-rollback-action';

/** Preserve or invalidate every tracked FK that observed a provisional identity. */
export function captureGeneratedRelationshipRollbackTargets(
    tracker: ChangeTracker,
    sources: readonly GeneratedIdentityRollbackSource[],
): void {
    if (sources.length === 0) return;
    const entries = tracker.entries().filter(entry =>
        entry.metadata.relationships.some(relationship =>
            sources.some(source =>
                source.entityType === relationship.principalEntity)));
    if (entries.length === 0) return;
    const captured = captureRelationshipDetectionValues(entries);
    const actions: Array<() => void> = [];
    for (const dependent of entries) {
        if (dependent.state === EntityState.Deleted ||
            dependent.state === EntityState.Detached) continue;
        for (const relationship of dependent.metadata.relationships as
            readonly TrackedRelationshipMetadata[]) {
            const candidates = sources.filter(source =>
                source.entityType === relationship.principalEntity);
            if (candidates.length === 0) continue;
            const bound = relationshipBoundValuesFor(dependent, captured);
            for (const source of candidates) {
                const action = prepareGeneratedRelationshipRollbackAction(
                    tracker, dependent, relationship, bound, source,
                );
                if (action) actions.push(action);
            }
        }
    }
    for (const action of actions) action();
}
