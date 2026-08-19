import { writeFailureAtomicProperty } from '../../failure-atomic-property-write';
import { readPropertyValue } from '../../model/property-value-access';
import { toBoundPropertyValue } from '../../model/value-converter/store-value';
import { runRestorationActions } from '../../restoration-actions';
import type { RestorationScope } from '../../restoration-scope';
import { EntityState } from '../../tracking/entity-state';
import type { SavePlanEntry } from '../save-plan';
import { savePlanExecution } from '../save-plan-execution';
import { incrementVersionValue } from './version-value-increment';
import { restorePropertyValue } from '../../property-value-restoration';
import { snapshotPropertyValue } from '../../tracking/snapshot-value';

/** Accept live and captured version increments under one rollback journal. */
export function acceptVersionIncrements(
    plan: readonly SavePlanEntry[],
    restoration: RestorationScope,
): () => void {
    const rollback: Array<() => void> = [];
    try {
        for (const item of plan) {
            if (item.state !== EntityState.Modified) continue;
            for (const persisted of savePlanExecution(item)?.persistedEntries ?? []) {
                for (const property of persisted.entry.metadata.properties) {
                    if (!property.isVersion) continue;
                    const name = property.propertyName;
                    const original = persisted.entry.originalValues[name];
                    if (original === null || original === undefined) continue;
                    const captured = persisted.values[name];
                    const current = readPropertyValue(
                        persisted.entry.entity, property,
                    );
                    const context =
                        `${persisted.entry.metadata.entityName}.${name}`;
                    const incremented = incrementVersionValue(
                        original, context,
                    );
                    const previousBound = persisted.boundValues[name];
                    rollback.push(() => {
                        persisted.values[name] = captured;
                        persisted.boundValues[name] = previousBound;
                    });
                    persisted.values[name] = incremented;
                    persisted.boundValues[name] = toBoundPropertyValue(
                        incremented, property,
                    );
                    if (!Object.is(current, captured)) continue;
                    writeFailureAtomicProperty({
                        entity: persisted.entry.entity,
                        property,
                        value: incremented,
                        scope: restoration,
                        context,
                        recordApplied: previous => {
                            const previousSnapshot = snapshotPropertyValue(
                                previous, property.converter, context,
                            );
                            rollback.push(() => {
                                restorePropertyValue(
                                    persisted.entry.entity, property, previous,
                                    previousSnapshot, context,
                                );
                            });
                        },
                    });
                }
            }
        }
    } catch (error) {
        restoration.capturePrimary(error);
        restoration.attemptAll([...rollback].reverse());
        throw error;
    }
    return () => {
        runRestorationActions([...rollback].reverse());
    };
}
