import { types } from 'node:util';
import type { QueryModel } from './query-model';
import type { ProjectionFieldExpression } from './projection-expression-types';

type OwnedProjectionQuery<TEntity extends object> = QueryModel<TEntity> & {
    readonly projection: readonly ProjectionFieldExpression[];
};
const fieldKeys: Set<PropertyKey> = new Set(['kind', 'alias', 'propertyName', 'sourceAlias', 'path']);

/** Own the exact flat instructions consumed by SQL and subsequent decoding. */
export function ownFlatProjectionQuery<TEntity extends object>(
    model: QueryModel<TEntity>,
): OwnedProjectionQuery<TEntity> | undefined {
    const ordinary = inspectPlainData(model);
    if (ordinary === undefined || !Object.hasOwn(model, 'entityType') ||
        !Object.hasOwn(model, 'projection') || !Object.hasOwn(model, 'joins')) return undefined;
    const source: unknown = model.projection;
    const joins: unknown = model.joins;
    if (!isDenseArray(source) || source.length === 0 || !isDenseArray(joins) || joins.length !== 0) return undefined;
    const projection: ProjectionFieldExpression[] = [];
    for (const value of source) {
        const item = ownField(value);
        if (!item) return undefined;
        projection.push(item);
    }
    const descriptor: PropertyDescriptor = {
        value: Object.freeze(projection), enumerable: true, writable: false, configurable: false,
    };
    // Preserve other query descriptors and references. Only projection ownership
    // changes; parameter values and unrelated query state remain execution-local.
    const prototype = Object.getPrototypeOf(model) as object | null;
    if (!ordinary) {
        const descriptors: PropertyDescriptorMap = Object.getOwnPropertyDescriptors(model);
        descriptors.projection = descriptor;
        return Object.create(prototype, descriptors) as OwnedProjectionQuery<TEntity>;
    }
    // Validation above rules out getters/proxies. Spread creates own data fields
    // without invoking inherited setters or allocating a second descriptor graph.
    const owned = { ...model };
    if (prototype === null) Object.setPrototypeOf(owned, null);
    Object.defineProperty(owned, 'projection', descriptor);
    return owned as OwnedProjectionQuery<TEntity>;
}

function ownField(value: unknown): ProjectionFieldExpression | undefined {
    if (inspectPlainData(value, fieldKeys) === undefined) return undefined;
    const record = value as Record<string, unknown>;
    if (!Object.hasOwn(record, 'kind') || !Object.hasOwn(record, 'alias') ||
        !Object.hasOwn(record, 'propertyName')) return undefined;
    const { kind, alias, propertyName } = record;
    if (kind !== 'field' || typeof alias !== 'string' || typeof propertyName !== 'string') return undefined;
    // Do not silently discard inherited optional fields or invoke their getters.
    for (const key of ['path', 'sourceAlias']) {
        if (!Object.hasOwn(record, key) && Object.getPrototypeOf(record) !== null && Object.hasOwn(Object.prototype, key)) return undefined;
    }
    const { sourceAlias, path } = record;
    if (sourceAlias !== undefined && sourceAlias !== 'root') return undefined;
    if (path !== undefined && (!isDenseArray(path) || path.length !== 1 || path[0] !== alias)) return undefined;
    return Object.freeze({
        kind, alias, propertyName, sourceAlias,
        path: path === undefined ? undefined : Object.freeze([alias]),
    });
}

/** Undefined declines the shape; false requires an exact-descriptor query copy. */
function inspectPlainData(value: unknown, allowedKeys?: ReadonlySet<PropertyKey>): boolean | undefined {
    if (typeof value !== 'object' || value === null || types.isProxy(value)) return undefined;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    let ordinary = true;
    for (const key of Reflect.ownKeys(value)) {
        if (allowedKeys && !allowedKeys.has(key)) return undefined;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) return undefined;
        ordinary = ordinary && descriptor.enumerable === true &&
            descriptor.configurable === true && descriptor.writable === true;
    }
    return ordinary;
}

function isDenseArray(value: unknown): value is readonly unknown[] {
    if (types.isProxy(value) || !Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return false;
    if (Reflect.ownKeys(value).length !== value.length + 1) return false;
    for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, index);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) return false;
    }
    return true;
}
