/** Render a key value without falling back to JavaScript's `[object Object]`. */
export function formatIdentityValue(value: unknown): string {
    if (value instanceof Date) {
        return value.toISOString();
    }

    switch (typeof value) {
        case 'object': {
            if (value === null) {
                return 'null';
            }
            const serialized: unknown = JSON.stringify(value);
            return typeof serialized === 'string'
                ? serialized
                : Object.prototype.toString.call(value);
        }
        case 'function':
            return value.name || 'function';
        case 'string':
            return value;
        case 'number':
        case 'boolean':
        case 'bigint':
        case 'symbol':
        case 'undefined':
            return String(value);
    }
}
