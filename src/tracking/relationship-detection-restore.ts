import type { ChangeTracker } from './change-tracker';
import { restoreRelationshipDetectionEntries } from './change-tracker-relationship-detection-registry';
import { restoreEntryLoadedNavigations } from './entity-entry-navigation-checkpoint';
import { cloneSnapshotValue } from './entity-entry';
import { restoreNavigationChangeDetectionState } from './navigation-change-detection-state';
import { registerTemporaryGeneratedIdentity } from './temporary-generated-identity';
import type { RelationshipDetectionCheckpoint } from './relationship-detection-journal';
import { runRestorationActions } from '../restoration-actions';
import { restorePropertyValue } from '../property-value-restoration';
import { navigationValueChanged } from './navigation-snapshot';
import { restorePropertyPath } from '../property-value-restoration';

export function restoreRelationshipDetection(
    tracker: ChangeTracker,
    checkpoints: readonly RelationshipDetectionCheckpoint[],
): void {
    const actions: Array<() => void> = [];
    for (const checkpoint of checkpoints) {
        for (const [propertyName, value] of checkpoint.properties) {
            actions.push(() => {
                const property = checkpoint.entry.metadata.getProperty(
                    propertyName,
                );
                const previous = cloneSnapshotValue(value);
                restorePropertyValue(
                    checkpoint.entry.entity, property, previous, previous,
                    `${checkpoint.entry.metadata.entityName}.${propertyName}`,
                );
            });
        }
        for (const complex of [...checkpoint.complex].sort(
            (left, right) => right.path.length - left.path.length,
        )) {
            actions.push(() => {
                restorePropertyPath(
                    checkpoint.entry.entity,
                    complex.path,
                    complex.value,
                    `${checkpoint.entry.metadata.entityName}.${complex.path.join('.')}`,
                );
            });
        }
        const entity = checkpoint.entry.entity as Record<string, unknown>;
        for (const [propertyName, value] of checkpoint.graph) {
            actions.push(() => {
                const previous = cloneGraphValue(value);
                entity[propertyName] = previous;
                if (navigationValueChanged(previous, entity[propertyName])) {
                    throw new Error(
                        `Navigation '${checkpoint.entry.metadata.entityName}.${propertyName}' refused its restoration value.`,
                    );
                }
            });
        }
        actions.push(() => {
            checkpoint.entry.restoreTrackedValues(
                checkpoint.originalValues,
                checkpoint.originalBoundValues,
                checkpoint.navigations,
                checkpoint.state,
            );
        });
        actions.push(() => {
            restoreEntryLoadedNavigations(
                checkpoint.entry, checkpoint.loaded,
            );
        });
        actions.push(() => {
            restoreNavigationChangeDetectionState(
                checkpoint.entry,
                checkpoint.suppressed,
            );
        });
        actions.push(() => {
            registerTemporaryGeneratedIdentity(
                checkpoint.entry,
                checkpoint.temporaryIdentity,
            );
        });
    }
    actions.push(() => {
        restoreRelationshipDetectionEntries(
            tracker, checkpoints,
        );
    });
    runRestorationActions(actions);
}

function cloneGraphValue(value: unknown): unknown {
    return isUnknownArray(value) ? [...value] : value;
}

function isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
}
