import { writePropertyValue } from '../model/property-value-access';
import type { ChangeTracker } from './change-tracker';
import { restoreRelationshipDetectionEntries } from './change-tracker-relationship-detection-registry';
import { restoreEntryLoadedNavigations } from './entity-entry-navigation-checkpoint';
import { cloneSnapshotValue } from './entity-entry';
import { restoreNavigationChangeDetectionState } from './navigation-change-detection-state';
import { registerTemporaryGeneratedIdentity } from './temporary-generated-identity';
import type { RelationshipDetectionCheckpoint } from './relationship-detection-journal';

export function restoreRelationshipDetection(
    tracker: ChangeTracker,
    checkpoints: readonly RelationshipDetectionCheckpoint[],
): void {
    for (const checkpoint of checkpoints) {
        for (const [propertyName, value] of checkpoint.properties) {
            writePropertyValue(
                checkpoint.entry.entity,
                checkpoint.entry.metadata.getProperty(propertyName),
                cloneSnapshotValue(value),
            );
        }
        const entity = checkpoint.entry.entity as Record<string, unknown>;
        for (const [propertyName, value] of checkpoint.graph) {
            entity[propertyName] = cloneGraphValue(value);
        }
        checkpoint.entry.restoreTrackedValues(
            checkpoint.originalValues,
            checkpoint.originalBoundValues,
            checkpoint.navigations,
            checkpoint.state,
        );
        restoreEntryLoadedNavigations(checkpoint.entry, checkpoint.loaded);
        restoreNavigationChangeDetectionState(
            checkpoint.entry,
            checkpoint.suppressed,
        );
        registerTemporaryGeneratedIdentity(
            checkpoint.entry,
            checkpoint.temporaryIdentity,
        );
    }
    restoreRelationshipDetectionEntries(tracker, checkpoints);
}

function cloneGraphValue(value: unknown): unknown {
    return isUnknownArray(value) ? [...value] : value;
}

function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}
