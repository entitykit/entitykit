import type {
    MutableSequenceMetadata,
    SequenceDataType,
    SequenceMetadata,
} from './sequence-metadata';
import type { SequenceBuilder } from './sequence-builder-types';

export class SequenceBuilderImplementation implements SequenceBuilder {
    constructor(private readonly metadata: MutableSequenceMetadata) {}

    public hasSchema(name: string): this {
        this.metadata.schemaName = requireName(name, 'Sequence schema');
        return this;
    }

    public hasDataType(dataType: SequenceDataType): this {
        this.metadata.dataType = dataType;
        return this;
    }

    public startsAt(value: number | bigint): this {
        this.metadata.startValue = requireInteger(value, 'Sequence start value');
        return this;
    }

    public incrementsBy(value: number | bigint): this {
        const increment = requireInteger(value, 'Sequence increment');
        if (increment === 0 || increment === 0n) {
            throw new Error('Sequence increment must not be zero.');
        }
        this.metadata.incrementBy = increment;
        return this;
    }

    public hasMin(value: number | bigint): this {
        this.metadata.minValue = requireInteger(value, 'Sequence minimum');
        return this;
    }

    public hasMax(value: number | bigint): this {
        this.metadata.maxValue = requireInteger(value, 'Sequence maximum');
        return this;
    }

    public isCyclic(enabled = true): this {
        this.metadata.isCyclic = enabled;
        return this;
    }

    public hasCache(size: number): this {
        if (!Number.isSafeInteger(size) || size <= 0) {
            throw new Error('Sequence cache must be a positive safe integer.');
        }
        this.metadata.cache = size;
        return this;
    }

    public build(): SequenceMetadata {
        validateBounds(this.metadata);
        return { ...this.metadata, isCyclic: this.metadata.isCyclic ?? false };
    }
}

function requireName(value: string, label: string): string {
    if (!value.trim()) {
        throw new Error(`${label} must not be empty.`);
    }
    return value.trim();
}

function requireInteger(value: number | bigint, label: string): number | bigint {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) {
        throw new Error(`${label} must be a safe integer or bigint.`);
    }
    return value;
}

function validateBounds(metadata: MutableSequenceMetadata): void {
    const minimum = toBigInt(metadata.minValue);
    const maximum = toBigInt(metadata.maxValue);
    const start = toBigInt(metadata.startValue);
    if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
        throw new Error('Sequence minimum must not exceed its maximum.');
    }
    if (start !== undefined && minimum !== undefined && start < minimum) {
        throw new Error('Sequence start value must not be below its minimum.');
    }
    if (start !== undefined && maximum !== undefined && start > maximum) {
        throw new Error('Sequence start value must not exceed its maximum.');
    }
}

function toBigInt(value: number | bigint | undefined): bigint | undefined {
    return value === undefined ? undefined : BigInt(value);
}
