type EncodedIdentityValue =
    | string
    | readonly EncodedIdentityValue[];

/** Stable, type-preserving key tuple used by identity and save-plan maps. */
export function encodeIdentityTuple(values: readonly unknown[]): string {
    return JSON.stringify([
        'entitykit:identity:v1',
        ...values.map(value => encodeIdentityValue(value, new Set())),
    ]);
}

/** Render a key value without falling back to JavaScript's `[object Object]`. */
export function formatIdentityValue(value: unknown): string {
    if (value instanceof Date) {
        const time = value.getTime();
        return Number.isNaN(time) ? 'Date(Invalid)' : value.toISOString();
    }
    if (value instanceof Uint8Array) {
        return bytesToHex(value);
    }
    if (Array.isArray(value)) {
        return encodeIdentityTuple(value);
    }

    switch (typeof value) {
        case 'string':
            return value;
        case 'object':
            return value === null
                ? 'null'
                : encodeIdentityTuple([value]);
        case 'function':
            return value.name || 'function';
        case 'number':
        case 'boolean':
        case 'bigint':
        case 'symbol':
        case 'undefined':
            return String(value);
    }
}

function encodeIdentityValue(
    value: unknown,
    ancestors: Set<object>,
): EncodedIdentityValue {
    if (value === null) {
        return ['null'];
    }
    if (typeof value === 'string') {
        return ['string', value];
    }
    if (typeof value === 'boolean') {
        return ['boolean', String(value)];
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new TypeError('Identity numbers must be finite.');
        }
        return ['number', Object.is(value, -0) ? '-0' : String(value)];
    }
    if (typeof value === 'bigint') {
        return ['bigint', value.toString()];
    }
    if (typeof value === 'undefined') {
        return ['undefined'];
    }
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) {
            throw new TypeError('Identity dates must be valid.');
        }
        return ['date', value.toISOString()];
    }
    if (value instanceof Uint8Array) {
        return ['bytes', bytesToHex(value)];
    }
    if (typeof value !== 'object') {
        throw new TypeError(`Unsupported identity value (${typeof value}).`);
    }
    if (ancestors.has(value)) {
        throw new TypeError('Identity values cannot contain cyclic references.');
    }

    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            return [
                'array',
                ...value.map(item => encodeIdentityValue(item, ancestors)),
            ];
        }
        const prototype: object | null = Object.getPrototypeOf(value) as object | null;
        if (prototype !== Object.prototype && prototype !== null) {
            throw new TypeError(
                `Unsupported identity value (${value.constructor.name || 'object'}).`,
            );
        }
        return [
            'object',
            ...Object.keys(value).sort().map(key => [
                key,
                encodeIdentityValue(
                    (value as Record<string, unknown>)[key],
                    ancestors,
                ),
            ]),
        ];
    } finally {
        ancestors.delete(value);
    }
}

function bytesToHex(value: Uint8Array): string {
    return `0x${Array.from(value, byte =>
        byte.toString(16).padStart(2, '0')).join('')}`;
}
