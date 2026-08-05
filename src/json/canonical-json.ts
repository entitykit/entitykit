import type { JsonValue } from '../json-value';

/** Serialize an already validated JSON snapshot with deterministic object keys. */
export function serializeCanonicalJson(value: JsonValue): string {
    if (Array.isArray(value)) {
        const items = value as readonly JsonValue[];
        return `[${items.map(item => serializeCanonicalJson(item)).join(',')}]`;
    }
    if (value !== null && typeof value === 'object') {
        const record = value as Readonly<Record<string, JsonValue>>;
        return `{${Object.keys(record)
            .sort(compareJsonKeys)
            .map(key => `${serializePrimitive(key)}:${serializeCanonicalJson(record[key])}`)
            .join(',')}}`;
    }
    return serializePrimitive(value);
}

export function compareJsonKeys(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function serializePrimitive(value: string | number | boolean | null): string {
    return JSON.stringify(value);
}
