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
    private readonly valuesByEntry: Map<EntityEntry<object>, Map<string, AppliedGeneratedValue>> = new Map();
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
        const indexed = this.valuesByEntry.get(entry) ?? new Map<string, AppliedGeneratedValue>();
        this.valuesByEntry.set(entry, indexed);
        for (const value of values) {
            const applied = {
                entry,
                propertyName: value.propertyName,
                persistedValue: value.persistedValue,
                boundValue: cloneSnapshotValue(value.boundValue),
            };
            this.values.push(applied);
            indexed.set(applied.propertyName, applied);
        }
    }

    public find(
        entity: object,
        propertyName: string,
    ): AppliedPropertyValue | undefined {
        const entry = this.changeTracker.entry(entity);
        const value = entry ? this.valuesByEntry.get(entry)?.get(propertyName) : undefined;
        return value ? {
            propertyName: value.propertyName,
            persistedValue: value.persistedValue,
            boundValue: cloneSnapshotValue(value.boundValue),
        } : undefined;
    }

    public take(): readonly AppliedGeneratedValue[] {
        this.sources.length = 0;
        this.valuesByEntry.clear();
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
