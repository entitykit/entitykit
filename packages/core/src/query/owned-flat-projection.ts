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
    const descriptors = plainDataDescriptors(model);
    if (!descriptors?.entityType || !descriptors.projection || !descriptors.joins) return undefined;
    const source: unknown = descriptors.projection.value;
    const joins: unknown = descriptors.joins.value;
    if (!isDenseArray(source) || source.length === 0 || !isDenseArray(joins) || joins.length !== 0) return undefined;
    const projection: ProjectionFieldExpression[] = [];
    for (const value of source) {
        const item = ownField(value);
        if (!item) return undefined;
        projection.push(item);
    }
    descriptors.projection = {
        value: Object.freeze(projection), enumerable: true, writable: false, configurable: false,
    };
    // Preserve other query descriptors and references. Only projection ownership
    // changes; parameter values and unrelated query state remain execution-local.
    const prototype = Object.getPrototypeOf(model) as object | null;
    return Object.create(prototype, descriptors as PropertyDescriptorMap) as OwnedProjectionQuery<TEntity>;
}

function ownField(value: unknown): ProjectionFieldExpression | undefined {
    const descriptors = plainDataDescriptors(value);
    if (!descriptors || Reflect.ownKeys(descriptors).some(key => !fieldKeys.has(key))) return undefined;
    const kind: unknown = descriptors.kind?.value;
    const alias: unknown = descriptors.alias?.value;
    const propertyName: unknown = descriptors.propertyName?.value;
    if (kind !== 'field' || typeof alias !== 'string' || typeof propertyName !== 'string') return undefined;
    // Do not silently discard inherited optional fields or invoke their getters.
    for (const key of ['path', 'sourceAlias']) {
        if (!descriptors[key] && Object.getPrototypeOf(value) !== null && Object.hasOwn(Object.prototype, key)) return undefined;
    }
    const sourceAlias: unknown = descriptors.sourceAlias?.value;
    const path: unknown = descriptors.path?.value;
    if (sourceAlias !== undefined && sourceAlias !== 'root') return undefined;
    if (path !== undefined && (!isDenseArray(path) || path.length !== 1 || path[0] !== alias)) return undefined;
    return Object.freeze({
        kind, alias, propertyName, sourceAlias,
        path: path === undefined ? undefined : Object.freeze([alias]),
    });
}

function plainDataDescriptors(value: unknown): Partial<PropertyDescriptorMap> | undefined {
    if (typeof value !== 'object' || value === null || types.isProxy(value)) return undefined;
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;
    const descriptors: Partial<PropertyDescriptorMap> = Object.getOwnPropertyDescriptors(value);
    Object.setPrototypeOf(descriptors, null);
    for (const key of Reflect.ownKeys(descriptors)) {
        const descriptor = descriptors[key];
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) return undefined;
    }
    return descriptors;
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
