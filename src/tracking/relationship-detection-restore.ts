import type { ChangeTracker } from './change-tracker';
import { restoreRelationshipDetectionEntries } from './change-tracker-relationship-detection-registry';
import { restoreEntryLoadedNavigations } from './entity-entry-navigation-checkpoint';
import { snapshotRestorableValue } from './restorable-value-snapshot';
import { restoreNavigationChangeDetectionState } from './navigation-change-detection-state';
import { registerTemporaryGeneratedIdentity } from './temporary-generated-identity';
import type { RelationshipDetectionCheckpoint } from './relationship-detection-journal';
import { runRestorationActions } from '../restoration-actions';
import { restorePropertyValue } from '../property-value-restoration';
import { restoreNavigationValue } from './navigation-value-restoration';
import { restorePropertyPath } from '../property-value-restoration';

export function restoreRelationshipDetection(
    tracker: ChangeTracker,
    checkpoints: readonly RelationshipDetectionCheckpoint[],
): void {
    const actions: Array<() => void> = [];
    for (const checkpoint of checkpoints) {
        for (const [propertyName, value] of checkpoint.properties) {
            actions.push(() => {
                const metadata = checkpoint.entry.metadata;
                const property = metadata.getProperty(propertyName);
                const context = `${metadata.entityName}.${propertyName}`;
                const previous = snapshotRestorableValue(
                    value, property.converter, context,
                );
                restorePropertyValue(
                    checkpoint.entry.entity, property, previous, previous,
                    context,
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
        for (const [propertyName, value] of checkpoint.graph) {
            actions.push(() => {
                restoreNavigationValue(
                    checkpoint.entry.entity,
                    propertyName,
                    value,
                    checkpoint.entry.metadata.entityName,
                );
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
