import type { MigrationBuilderCore } from './migration-builder-core';
import type { MigrationSequenceDefinition } from './migration-builder-types';

export function createSequence(
    core: MigrationBuilderCore,
    sequence: MigrationSequenceDefinition,
): void {
    validateSequence(sequence);
    const statement = core.dialect.createSequenceStatement?.(sequence);
    core.assertCapability(
        statement !== undefined,
        'createSequence',
        'Use a provider with sequence support or a provider-specific default-value strategy.',
    );
    if (statement !== undefined) {
        core.emitDdl(statement);
    }
}

export function alterSequence(
    core: MigrationBuilderCore,
    sequence: MigrationSequenceDefinition,
    previous: MigrationSequenceDefinition,
): void {
    validateSequence(sequence);
    validateSequence(previous);
    const statement = core.dialect.alterSequenceStatement?.(sequence, previous);
    core.assertCapability(
        statement !== undefined,
        'alterSequence',
        'Use builder.sql(...) with reviewed provider SQL.',
    );
    if (statement !== undefined) {
        core.emitDdl(statement);
    }
}

export function dropSequence(
    core: MigrationBuilderCore,
    sequence: MigrationSequenceDefinition,
): void {
    validateSequence(sequence);
    const statement = core.dialect.dropSequenceStatement?.(sequence);
    core.assertCapability(
        statement !== undefined,
        'dropSequence',
        'Use a provider with sequence support or builder.sql(...) with reviewed provider SQL.',
    );
    if (statement !== undefined) {
        core.emitDdl(statement);
    }
}

function validateSequence(sequence: MigrationSequenceDefinition): void {
    if (!sequence.name.trim()) {
        throw new Error('Sequence name must not be empty.');
    }
    if (sequence.schemaName !== undefined && !sequence.schemaName.trim()) {
        throw new Error('Sequence schema must not be empty.');
    }
    if (
        sequence.dataType !== undefined &&
        !['smallint', 'integer', 'bigint'].includes(sequence.dataType)
    ) {
        throw new Error(`Sequence data type '${sequence.dataType}' is not supported.`);
    }
    const values = [
        ['start value', sequence.startValue],
        ['increment', sequence.incrementBy],
        ['minimum', sequence.minValue],
        ['maximum', sequence.maxValue],
    ] as const;
    for (const [label, value] of values) {
        if (value !== undefined && !/^-?\d+$/.test(value)) {
            throw new Error(`Sequence ${label} must be an integer.`);
        }
    }
    if (sequence.incrementBy !== undefined && BigInt(sequence.incrementBy) === 0n) {
        throw new Error('Sequence increment must not be zero.');
    }
    if (
        sequence.cache !== undefined &&
        (!Number.isSafeInteger(sequence.cache) || sequence.cache <= 0)
    ) {
        throw new Error('Sequence cache must be a positive safe integer.');
    }
    const minimum = integer(sequence.minValue);
    const maximum = integer(sequence.maxValue);
    const start = integer(sequence.startValue);
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

function integer(value: string | undefined): bigint | undefined {
    return value === undefined ? undefined : BigInt(value);
}
