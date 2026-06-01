import {
    isSerializedBigIntDefault,
    normalizeDefaultValue,
} from '../model/default-value';

export function formatDefaultValue(value: unknown): string {
    if (isSerializedBigIntDefault(value)) {
        return value.value;
    }

    const normalized = normalizeDefaultValue(value);
    if (normalized === null) {
        return 'null';
    }

    if (typeof normalized === 'number' || typeof normalized === 'bigint') {
        return String(normalized);
    }

    if (typeof normalized === 'boolean') {
        return normalized ? 'true' : 'false';
    }

    if (typeof normalized === 'object') {
        const serialized: unknown = JSON.stringify(normalized);
        if (typeof serialized !== 'string') {
            throw new TypeError('Default value objects must be JSON serializable.');
        }
        return quoteLiteral(serialized);
    }

    if (typeof normalized === 'string') {
        return quoteLiteral(normalized);
    }

    return quoteLiteral('undefined');
}

function quoteLiteral(value: string): string {
    return `'${value.replace(/'/g, '\'\'')}'`;
}
