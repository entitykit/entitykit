import type { Model } from '../model/model';
import { DeleteBehavior } from '../model/relationship-metadata';
import type { ChangeTracker } from './change-tracker';
import { EntityState } from './entity-state';
import {
    cascadeDeleteDependent,
    severDependent,
} from './relationship-fixup';
import { relationshipConnects } from './relationship-resolution';
import type { TrackedRelationshipMetadata } from './tracked-relationship-metadata';
import type { RelationshipDetectionValues } from './relationship-detection-values';

/** Apply configured delete behavior to dependents already tracked in memory. */
export function detectTrackedCascades(
    tracker: ChangeTracker,
    model: Model,
    captured: RelationshipDetectionValues,
): void {
    let changed = true;
    while (changed) {
        changed = false;
        const entries = tracker.entries();
        for (const principal of entries) {
            if (principal.state !== EntityState.Deleted) {
                continue;
            }
            for (const dependent of entries) {
                if (
                    dependent.state === EntityState.Deleted ||
                    dependent.state === EntityState.Detached
                ) {
                    continue;
                }
                const relationships = dependent.metadata.relationships as
                    readonly TrackedRelationshipMetadata[];
                for (const relationship of relationships) {
                    if (
                        relationship.principalEntity !== principal.metadata.ctor ||
                        !relationshipConnects(
                            tracker,
                            model,
                            dependent,
                            relationship,
                            principal,
                            captured,
                        )
                    ) {
                        continue;
                    }
                    if (relationship.deleteBehavior === DeleteBehavior.Cascade) {
                        cascadeDeleteDependent(
                            tracker,
                            dependent,
                            relationship,
                            principal.entity,
                        );
                        changed = true;
                    } else if (
                        relationship.deleteBehavior === DeleteBehavior.SetNull
                    ) {
                        severDependent(
                            tracker,
                            dependent,
                            relationship,
                            principal.entity,
                            captured,
                        );
                    }
                }
            }
        }
    }
}
