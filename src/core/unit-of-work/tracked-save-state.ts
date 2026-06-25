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

export class TrackedSaveState {
    constructor(
        private readonly changeTracker: ChangeTracker,
        private readonly saveTimeWrites: SaveTimeWrites,
        private readonly manyToMany: ManyToManyChangeSet,
    ) {}

    public accept(plan: readonly SavePlanEntry[]): void {
        this.acceptVersionIncrements(plan);
        this.changeTracker.acceptAllChanges();
        this.saveTimeWrites.accept();
        this.manyToMany.clear();
    }

    public validateVersionValues(plan: readonly SavePlanEntry[]): void {
        this.forEachVersionValue(plan, (_values, _propertyName, value, path) => {
            incrementVersionValue(value, path);
        });
    }

    public restoreSaveTimeWrites(): void {
        this.saveTimeWrites.restore();
    }

    private acceptVersionIncrements(plan: readonly SavePlanEntry[]): void {
        this.forEachVersionValue(plan, (entity, property, value, path) => {
            writePropertyValue(
                entity,
                property,
                incrementVersionValue(value, path),
            );
        });
    }

    private forEachVersionValue(
        plan: readonly SavePlanEntry[],
        visit: (
            entity: object,
            property: PropertyMetadata,
            value: unknown,
            propertyPath: string,
        ) => void,
    ): void {
        for (const item of plan) {
            if (item.state !== EntityState.Modified) {
                continue;
            }

            const entry = this.changeTracker.entry(item.entity);
            for (const property of entry?.metadata.properties ?? []) {
                if (!property.isVersion) {
                    continue;
                }

                const value = readPropertyValue(item.entity, property);
                if (value === null || value === undefined) {
                    continue;
                }

                visit(
                    item.entity,
                    property,
                    value,
                    `${entry?.metadata.entityName ?? 'entity'}.${property.propertyName}`,
                );
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
