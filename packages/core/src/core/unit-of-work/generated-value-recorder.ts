import type { ChangeTracker } from '../../tracking/change-tracker';
import type {
    AppliedGeneratedValue,
    AppliedPropertyValue,
} from './applied-generated-value';
import type { GeneratedIdentityRollbackSource } from '../../tracking/generated-identity-rollback-source';
import type { EntityEntry } from '../../tracking/entity-entry';
import { generatedRollbackSource } from './generated-rollback-source';
import { cloneSnapshotValue } from '../../tracking/snapshot-value-clone';

export class GeneratedValueRecorder {
    private readonly values: AppliedGeneratedValue[] = [];
    private readonly sources: GeneratedIdentityRollbackSource[] = [];

    constructor(private readonly changeTracker: ChangeTracker) {}

    public record(
        entity: object,
        values: readonly AppliedPropertyValue[],
        sourceBoundValues: Readonly<Record<string, unknown>>,
    ): void {
        const entry = this.register(entity, values, sourceBoundValues);
        this.recordApplied(entry, values);
    }

    public register(
        entity: object,
        values: readonly AppliedPropertyValue[],
        sourceBoundValues: Readonly<Record<string, unknown>>,
    ): EntityEntry<object> {
        const entry = this.requireEntry(entity);
        this.sources.push(generatedRollbackSource(
            entry.metadata,
            entry.entity,
            values,
            sourceBoundValues,
            entry,
        ));
        return entry;
    }

    public recordApplied(
        entry: EntityEntry<object>,
        values: readonly AppliedPropertyValue[],
    ): void {
        for (const value of values) {
            this.values.push({
                entry,
                propertyName: value.propertyName,
                persistedValue: value.persistedValue,
                boundValue: cloneSnapshotValue(value.boundValue),
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
                    persistedValue: value.persistedValue,
                    boundValue: cloneSnapshotValue(value.boundValue),
                };
            }
        }
        return undefined;
    }

    public take(): readonly AppliedGeneratedValue[] {
        this.sources.length = 0;
        return this.values.splice(0);
    }

    public rollbackSources(): readonly GeneratedIdentityRollbackSource[] {
        return [...this.sources];
    }

    private requireEntry(entity: object): EntityEntry<object> {
        const entry = this.changeTracker.entry(entity);
        if (!entry) {
            throw new Error('Generated values require their entity to remain tracked.');
        }
        return entry;
    }
}
