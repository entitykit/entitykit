import type { ChangeTracker } from '../../tracking/change-tracker';
import { EntityState } from '../../tracking/entity-state';
import type { ManyToManyChangeSet } from '../many-to-many-change-set';
import type { SavePlanEntry } from '../save-plan';
import type { SaveTimeWrites } from '../save-time-writes';
import {
    readPropertyValue,
    writePropertyValue,
} from '../../model/property-value-access';
import type { PropertyMetadata } from '../../model/property-metadata';
import { savePlanExecution } from '../save-plan-execution';
import { readEntityValues } from '../../tracking/entity-entry-snapshot';

export class TrackedSaveState {
    constructor(
        private readonly changeTracker: ChangeTracker,
        private readonly saveTimeWrites: SaveTimeWrites,
        private readonly manyToMany: ManyToManyChangeSet,
    ) {}

    public accept(plan: readonly SavePlanEntry[]): () => void {
        this.acceptGeneratedValues(plan);
        const rollbackVersions = this.acceptVersionIncrements(plan);
        const rollbackTracker = this.changeTracker.acceptPersistedChanges(
            plan.flatMap(item => savePlanExecution(item)?.persistedEntries ?? []),
        );
        const rollbackSaveTimeWrites = this.saveTimeWrites.acceptWithRollback();
        const rollbackManyToMany = this.manyToMany.accept(
            plan.flatMap(item => savePlanExecution(item)?.manyToManyChanges ?? []),
        );
        return () => {
            rollbackTracker();
            rollbackVersions();
            rollbackSaveTimeWrites();
            rollbackManyToMany();
        };
    }

    public validateVersionValues(plan: readonly SavePlanEntry[]): void {
        this.forEachVersionValue(plan, (_values, _propertyName, value, path) => {
            incrementVersionValue(value, path);
        });
    }

    public restoreSaveTimeWrites(): void {
        this.saveTimeWrites.restore();
    }

    private acceptVersionIncrements(plan: readonly SavePlanEntry[]): () => void {
        const rollback: Array<() => void> = [];
        this.forEachVersionValue(plan, (entity, property, value, path, values) => {
            const incremented = incrementVersionValue(value, path);
            values[property.propertyName] = incremented;
            if (readPropertyValue(entity, property) === value) {
                rollback.push(() => {
                    writePropertyValue(entity, property, value);
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

    private acceptGeneratedValues(plan: readonly SavePlanEntry[]): void {
        for (const item of plan) {
            const execution = savePlanExecution(item);
            const generated = execution?.generatedValues;
            const persisted = execution?.persistedEntries?.find(snapshot =>
                snapshot.entry.entity === item.entity);
            if (generated && persisted) {
                const current = readEntityValues(generated.metadata, item.entity);
                for (const propertyName of generated.propertyNames) {
                    persisted.values[propertyName] = current[propertyName];
                }
            }
            for (const propagation of execution?.generatedKeyPropagations ?? []) {
                if (!persisted) {
                    continue;
                }
                const current = readEntityValues(persisted.entry.metadata, item.entity);
                for (const propertyName of propagation.foreignKeyProperties) {
                    persisted.values[propertyName] = current[propertyName];
                }
            }
        }
    }

    private forEachVersionValue(
        plan: readonly SavePlanEntry[],
        visit: (
            entity: object,
            property: PropertyMetadata,
            value: unknown,
            propertyPath: string,
            persistedValues: Record<string, unknown>,
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

                    const value = persisted.values[property.propertyName];
                    if (value === null || value === undefined) {
                        continue;
                    }

                    visit(
                        persisted.entry.entity,
                        property,
                        value,
                        `${persisted.entry.metadata.entityName}.${property.propertyName}`,
                        persisted.values,
                    );
                }
            }
        }
    }
}

function incrementVersionValue(value: unknown, propertyPath: string): unknown {
    if (typeof value === 'number') {
        return value + 1;
    }
    if (typeof value === 'bigint') {
        return value + 1n;
    }
    if (typeof value === 'string' && /^-?\d+$/.test(value)) {
        return (BigInt(value) + 1n).toString();
    }

    throw new Error(
        `Version property '${propertyPath}' holds a non-numeric value (${typeof value}) and cannot be incremented after save. Version columns must map to a number, a bigint, or an integer string.`,
    );
}
