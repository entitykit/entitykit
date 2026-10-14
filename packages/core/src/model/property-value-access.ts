import type { PropertyMetadata } from './property-metadata';

export function readPropertyValue(
    entity: object,
    property: PropertyMetadata,
): unknown {
    return readPropertyPath(entity, property.propertyPath);
}

export function readPropertyPath(
    entity: object,
    path: readonly string[],
): unknown {
    let current: unknown = entity;
    for (const segment of path) {
        if (current === null || current === undefined) {
            return null;
        }
        if (typeof current !== 'object') {
            return undefined;
        }
        current = (current as Record<string, unknown>)[segment];
    }
    return current;
}

export function writePropertyValue(
    entity: object,
    property: PropertyMetadata,
    value: unknown,
): void {
    writePropertyPath(entity, property.propertyPath, value);
}

export function writePropertyPath(
    entity: object,
    path: readonly string[],
    value: unknown,
): void {
    const { target, propertyName } = propertyValueTarget(entity, path);
    setValue(target, propertyName, value);
}

export function propertyValueTarget(
    entity: object,
    path: readonly string[],
): { target: Record<string, unknown>; propertyName: string } {
    const propertyName = path.at(-1);
    if (!propertyName) {
        throw new Error('Mapped property paths must contain at least one segment.');
    }
    let current = entity as Record<string, unknown>;
    for (const segment of path.slice(0, -1)) {
        const nested = current[segment];
        if (nested === null || nested === undefined) {
            const created: Record<string, unknown> = {};
            setValue(current, segment, created);
            current = created;
            continue;
        }
        if (typeof nested !== 'object') {
            throw new Error(
                `Cannot write mapped path '${path.join('.')}' through non-object segment '${segment}'.`,
            );
        }
        current = nested as Record<string, unknown>;
    }
    return { target: current, propertyName };
}

export function hasPropertyPath(
    value: object,
    path: readonly string[],
): boolean {
    let current: unknown = value;
    for (const segment of path) {
        if (current === null) {
            return true;
        }
        if (typeof current !== 'object') {
            return false;
        }
        if (!Object.prototype.hasOwnProperty.call(current, segment)) {
            return false;
        }
        current = (current as Record<string, unknown>)[segment];
    }
    return true;
}

function setValue(
    target: Record<string, unknown>,
    key: string,
    value: unknown,
): void {
    if (key === '__proto__') {
        Object.defineProperty(target, key, {
            configurable: true,
            enumerable: true,
            value,
            writable: true,
        });
        return;
    }
    if (!Reflect.set(target, key, value, target)) {
        throw new TypeError(`Cannot write mapped property '${key}'.`);
    }
}
