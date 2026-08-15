import type { ChangeTracker } from '../../tracking/change-tracker';
import type {
    AppliedGeneratedValue,
    AppliedPropertyValue,
} from './applied-generated-value';
import { cloneSnapshotValue } from '../../tracking/snapshot-value-clone';
import { cloneBoundValues } from '../../tracking/bound-value-snapshot';
import type { GeneratedIdentityRollbackSource } from '../../tracking/generated-identity-rollback-source';

export class GeneratedValueRecorder {
    private readonly values: AppliedGeneratedValue[] = [];
    private readonly sourceBoundValues: Map<
        AppliedGeneratedValue['entry'], Record<string, unknown>
    > = new Map();

    constructor(private readonly changeTracker: ChangeTracker) {}

    public record(
        entity: object,
        values: readonly AppliedPropertyValue[],
        sourceBoundValues: Readonly<Record<string, unknown>>,
    ): void {
        const entry = this.changeTracker.entry(entity);
        if (!entry) {
            throw new Error('Generated values require their entity to remain tracked.');
        }
        if (!this.sourceBoundValues.has(entry)) {
            this.sourceBoundValues.set(
                entry, cloneBoundValues(sourceBoundValues),
            );
        }
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
        this.sourceBoundValues.clear();
        return this.values.splice(0);
    }

    public rollbackSources(): readonly GeneratedIdentityRollbackSource[] {
        const grouped: Map<
            AppliedGeneratedValue['entry'], AppliedGeneratedValue[]
        > = new Map();
        for (const value of this.values) {
            const entryValues = grouped.get(value.entry) ?? [];
            entryValues.push(value);
            grouped.set(value.entry, entryValues);
        }
        return [...grouped].map(([entry, generated]) => {
            const boundValues = cloneBoundValues(
                this.sourceBoundValues.get(entry) ?? {},
            );
            for (const value of generated) {
                boundValues[value.propertyName] = cloneSnapshotValue(
                    value.boundValue,
                );
            }
            return {
                entity: entry.entity,
                entityType: entry.metadata.ctor,
                keyProperties: entry.metadata.keyProperties.map(String),
                tenantKeyProperty: entry.metadata.tenantKeyProperty,
                principal: entry,
                generatedProperties: new Set(generated.map(
                    value => value.propertyName,
                )),
                boundValues,
            };
        });
    }
}
