/** Convert arbitrary diagnostic details into a bounded JSON-safe record. */
export function sanitizeErrorDetails(
    details: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
    const sanitized = sanitizeValue(details, new Set(), 0);
    return isRecord(sanitized) ? sanitized : { unavailable: sanitized };
}

function sanitizeValue(
    value: unknown,
    ancestors: Set<object>,
    depth: number,
): unknown {
    try {
        return sanitizeValueUnsafe(value, ancestors, depth);
    } catch {
        return '[Unserializable]';
    }
}

function sanitizeValueUnsafe(
    value: unknown,
    ancestors: Set<object>,
    depth: number,
): unknown {
    if (value === null || value === undefined ||
        typeof value === 'boolean' || typeof value === 'number') {
        return value;
    }
    if (typeof value === 'string') {
        return value.length > 500 ? `${value.slice(0, 500)}…` : value;
    }
    if (typeof value === 'bigint') {
        return `${String(value)}n`;
    }
    if (typeof value === 'symbol' || typeof value === 'function') {
        return `[${typeof value}]`;
    }
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? '[Invalid Date]' : value.toISOString();
    }
    if (value instanceof Error) {
        return { name: value.name };
    }
    if (depth >= 4) {
        return '[Maximum depth]';
    }
    if (ancestors.has(value)) {
        return '[Circular]';
    }
    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            return sanitizeArray(value, ancestors, depth);
        }
        if (value instanceof Uint8Array) {
            return `[Uint8Array length=${String(value.byteLength)}]`;
        }
        return sanitizeObject(value as Record<string, unknown>, ancestors, depth);
    } finally {
        ancestors.delete(value);
    }
}

function sanitizeArray(
    value: readonly unknown[],
    ancestors: Set<object>,
    depth: number,
): readonly unknown[] {
    const descriptor = Object.getOwnPropertyDescriptor(value, 'length');
    const length = typeof descriptor?.value === 'number'
        ? Math.min(descriptor.value, 100)
        : 0;
    return Array.from({ length }, (_, index) => {
        const item = Object.getOwnPropertyDescriptor(value, String(index));
        if (!item) {
            return null;
        }
        return 'value' in item
            ? sanitizeValue(item.value, ancestors, depth + 1)
            : '[Accessor]';
    });
}

function sanitizeObject(
    value: Record<string, unknown>,
    ancestors: Set<object>,
    depth: number,
): Readonly<Record<string, unknown>> {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    return Object.fromEntries(Object.entries(descriptors)
        .filter(([, descriptor]) => descriptor.enumerable)
        .slice(0, 100)
        .map(([key, descriptor]) => [
            key,
            'value' in descriptor
                ? sanitizeValue(descriptor.value, ancestors, depth + 1)
                : '[Accessor]',
        ]));
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
