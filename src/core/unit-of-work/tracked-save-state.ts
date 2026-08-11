import type { ChangeTracker } from '../../tracking/change-tracker';
import { EntityState } from '../../tracking/entity-state';
import type { ManyToManyChangeSet } from '../many-to-many-change-set';
import type { SavePlanEntry } from '../save-plan';
import type { SaveTimeWrites } from '../save-time-writes';
import { readPropertyValue, writePropertyValue } from '../../model/property-value-access';
import type { PropertyMetadata } from '../../model/property-metadata';
import { savePlanExecution } from '../save-plan-execution';
import type { AppliedGeneratedValue } from './applied-generated-value';
import type { SaveStateAcceptance } from './save-state-acceptance';
import { acceptSaveState } from './save-state-acceptor';
import { incrementVersionValue } from './version-value-increment';
import { toBoundPropertyValue } from '../../model/value-converter/store-value';

export class TrackedSaveState {
    constructor(
        private readonly changeTracker: ChangeTracker,
        private readonly saveTimeWrites: SaveTimeWrites,
        private readonly manyToMany: ManyToManyChangeSet,
    ) {}

    public accept(
        plan: readonly SavePlanEntry[],
        generatedValues: readonly AppliedGeneratedValue[] = [],
    ): SaveStateAcceptance {
        this.mergeGeneratedValues(plan, generatedValues);
        const rollbackVersions = this.acceptVersionIncrements(plan);
        return acceptSaveState({
            changeTracker: this.changeTracker,
            saveTimeWrites: this.saveTimeWrites,
            manyToMany: this.manyToMany,
            persistedEntries: plan.flatMap(item =>
                savePlanExecution(item)?.persistedEntries ?? []),
            manyToManyChanges: plan.flatMap(item =>
                savePlanExecution(item)?.manyToManyChanges ?? []),
            rollbackVersions,
        });
    }

    public validateVersionValues(plan: readonly SavePlanEntry[]): void {
        this.forEachVersionValue(plan, (
            _entity,
            _property,
            _capturedValue,
            originalValue,
            path,
        ) => {
            incrementVersionValue(originalValue, path);
        });
    }

    public restoreSaveTimeWrites(): void {
        this.saveTimeWrites.restore();
    }

    private acceptVersionIncrements(plan: readonly SavePlanEntry[]): () => void {
        const rollback: Array<() => void> = [];
        this.forEachVersionValue(plan, (
            entity,
            property,
            capturedValue,
            originalValue,
            path,
            values,
            boundValues,
        ) => {
            const incremented = incrementVersionValue(originalValue, path);
            values[property.propertyName] = incremented;
            boundValues[property.propertyName] = toBoundPropertyValue(
                incremented,
                property,
            );
            if (Object.is(readPropertyValue(entity, property), capturedValue)) {
                rollback.push(() => {
                    writePropertyValue(entity, property, capturedValue);
                });
                writePropertyValue(entity, property, incremented);
            }
        });
        return () => {
            for (const restore of rollback.reverse()) {
                restore();
            }
        };
    }

    private mergeGeneratedValues(
        plan: readonly SavePlanEntry[],
        generatedValues: readonly AppliedGeneratedValue[],
    ): void {
        const persisted = plan.flatMap(item =>
            savePlanExecution(item)?.persistedEntries ?? []);
        for (const generated of generatedValues) {
            const snapshot = persisted.find(item => item.entry === generated.entry);
            if (snapshot) {
                snapshot.values[generated.propertyName] = generated.persistedValue;
                snapshot.boundValues[generated.propertyName] =
                    generated.boundValue;
            }
        }
    }

    private forEachVersionValue(
        plan: readonly SavePlanEntry[],
        visit: (
            entity: object,
            property: PropertyMetadata,
            capturedValue: unknown,
            originalValue: unknown,
            propertyPath: string,
            persistedValues: Record<string, unknown>,
            persistedBoundValues: Record<string, unknown>,
        ) => void,
    ): void {
        for (const item of plan) {
            if (item.state !== EntityState.Modified) {
                continue;
            }

            for (const persisted of savePlanExecution(item)?.persistedEntries ?? []) {
                for (const property of persisted.entry.metadata.properties) {
                    if (!property.isVersion) {
                        continue;
                    }

                    const capturedValue = persisted.values[property.propertyName];
                    const originalValue = persisted.entry.originalValues[
                        property.propertyName
                    ];
                    if (originalValue === null || originalValue === undefined) {
                        continue;
                    }

                    visit(
                        persisted.entry.entity,
                        property,
                        capturedValue,
                        originalValue,
                        `${persisted.entry.metadata.entityName}.${property.propertyName}`,
                        persisted.values,
                        persisted.boundValues,
                    );
                }
            }
        }
    }
}
