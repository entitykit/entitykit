/** Format a diagnostic value without throwing on supported runtime shapes. */
export function formatDebugValue(value: unknown): string {
    try {
        return formatValue(value, new Set(), 0);
    } catch {
        return '[Unformattable]';
    }
}

function formatValue(
    value: unknown,
    ancestors: Set<object>,
    depth: number,
): string {
    if (value === null || value === undefined) {
        return String(value);
    }
    if (typeof value === 'string') {
        return JSON.stringify(truncate(value, 160));
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    if (typeof value === 'bigint') {
        return `${String(value)}n`;
    }
    if (typeof value === 'symbol') {
        return `[Symbol ${truncate(value.description ?? '', 80)}]`;
    }
    if (typeof value === 'function') {
        return `[Function ${truncate(value.name || 'anonymous', 80)}]`;
    }
    if (value instanceof Date) {
        const time = value.getTime();
        return Number.isNaN(time)
            ? 'Date(Invalid)'
            : `Date(${JSON.stringify(value.toISOString())})`;
    }
    if (value instanceof Uint8Array) {
        const preview = Array.from(value.slice(0, 32), byte =>
            byte.toString(16).padStart(2, '0')).join('');
        return `Uint8Array(length=${String(value.length)}, hex=${preview}${
            value.length > 32 ? '…' : ''
        })`;
    }
    if (ancestors.has(value)) {
        return '[Circular]';
    }
    if (depth >= 4) {
        return '[Object]';
    }

    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            return `[${value.slice(0, 20).map(item =>
                formatValue(item, ancestors, depth + 1)).join(', ')}${
                value.length > 20 ? ', …' : ''
            }]`;
        }
        const descriptors = Object.getOwnPropertyDescriptors(value);
        const keys = Reflect.ownKeys(descriptors);
        const entries = keys.slice(0, 20).map(key => {
            const descriptor = descriptors[key as keyof typeof descriptors];
            const label = typeof key === 'symbol'
                ? `[${String(key)}]`
                : JSON.stringify(key);
            const rendered = 'value' in descriptor
                ? formatValue(descriptor.value, ancestors, depth + 1)
                : '[Accessor]';
            return `${label}: ${rendered}`;
        });
        return `{${entries.join(', ')}${keys.length > 20 ? ', …' : ''}}`;
    } finally {
        ancestors.delete(value);
    }
}

function truncate(value: string, length: number): string {
    return value.length <= length
        ? value
        : `${value.slice(0, length)}…(+${
            String(value.length - length)
        } chars)`;
}
