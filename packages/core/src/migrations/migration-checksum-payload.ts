import type { MigrationStatement } from './migration-builder';

const checksumFormat = 'entitykit-migration-checksum';
const checksumFormatVersion = 1;

/**
 * Canonical, versioned migration content used by the history checksum.
 *
 * Both directions matter: an edited down migration can be executed by a later
 * target rollback even though its up migration was already applied.
 */
export function migrationChecksumPayload(
    upStatements: readonly MigrationStatement[],
    downStatements: readonly MigrationStatement[],
): string {
    return JSON.stringify([
        checksumFormat,
        checksumFormatVersion,
        ['up', ...upStatements.map(statementPayload)],
        ['down', ...downStatements.map(statementPayload)],
    ]);
}

function statementPayload(statement: MigrationStatement): unknown {
    return [
        statement.text,
        statement.values.map(value => canonicalValue(value, new Set())),
        statement.suppressTransaction === true,
    ];
}

function canonicalValue(
    value: unknown,
    ancestors: Set<object>,
): unknown {
    if (value === null) {
        return ['null'];
    }
    if (value === undefined) {
        return ['undefined'];
    }
    if (typeof value === 'string' || typeof value === 'boolean') {
        return [typeof value, value];
    }
    if (typeof value === 'number') {
        return ['number', canonicalNumber(value)];
    }
    if (typeof value === 'bigint') {
        return ['bigint', value.toString()];
    }
    if (value instanceof Date) {
        return ['date', value.toISOString()];
    }
    if (value instanceof Uint8Array) {
        return ['bytes', Buffer.from(
            value.buffer,
            value.byteOffset,
            value.byteLength,
        ).toString('base64')];
    }
    if (Array.isArray(value)) {
        return withAncestor(value, ancestors, () =>
            ['array', value.map(item => canonicalValue(item, ancestors))],
        );
    }
    if (typeof value === 'object') {
        const prototype: unknown = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            throw new TypeError(
                `Migration checksum values cannot contain ${value.constructor.name || 'custom'} objects.`,
            );
        }
        return withAncestor(value, ancestors, () => [
            'object',
            Object.keys(value)
                .sort()
                .map(key => [
                    key,
                    canonicalValue(
                        (value as Record<string, unknown>)[key],
                        ancestors,
                    ),
                ]),
        ]);
    }

    throw new TypeError(
        `Migration checksum values cannot contain ${typeof value} values.`,
    );
}

function canonicalNumber(value: number): number | string {
    if (Number.isNaN(value)) {
        return 'NaN';
    }
    if (value === Infinity) {
        return 'Infinity';
    }
    if (value === -Infinity) {
        return '-Infinity';
    }
    return Object.is(value, -0) ? '-0' : value;
}

function withAncestor<T>(
    value: object,
    ancestors: Set<object>,
    read: () => T,
): T {
    if (ancestors.has(value)) {
        throw new TypeError('Migration checksum values cannot contain cycles.');
    }
    ancestors.add(value);
    try {
        return read();
    } finally {
        ancestors.delete(value);
    }
}
