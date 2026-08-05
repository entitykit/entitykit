import type { ChangeTracker } from '../../tracking/change-tracker';
import type {
    AppliedGeneratedValue,
    AppliedPropertyValue,
} from './applied-generated-value';
import { cloneSnapshotValue } from '../../tracking/snapshot-value';

export class GeneratedValueRecorder {
    private readonly values: AppliedGeneratedValue[] = [];

    constructor(private readonly changeTracker: ChangeTracker) {}

    public record(
        entity: object,
        values: readonly AppliedPropertyValue[],
    ): void {
        const entry = this.changeTracker.entry(entity);
        if (!entry) {
            throw new Error('Generated values require their entity to remain tracked.');
        }
        for (const value of values) {
            this.values.push({
                entry,
                propertyName: value.propertyName,
                persistedValue: cloneSnapshotValue(value.persistedValue),
            });
        }
    }

    public find(
        entity: object,
        propertyName: string,
    ): AppliedPropertyValue | undefined {
        const entry = this.changeTracker.entry(entity);
        for (let index = this.values.length - 1; index >= 0; index -= 1) {
            const value = this.values[index];
            if (value.entry === entry && value.propertyName === propertyName) {
                return {
                    propertyName: value.propertyName,
                    persistedValue: cloneSnapshotValue(value.persistedValue),
                };
            }
        }
        return undefined;
    }

    public take(): readonly AppliedGeneratedValue[] {
        return this.values.splice(0);
    }
}
