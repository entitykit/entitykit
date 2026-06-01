/**
 * Awaitable lazy loading.
 *
 * EF Core loads a navigation during property access because a C# getter can
 * block its thread on I/O. Node cannot, so a faithful port of that proxy is not
 * available in TypeScript — anything that appeared to work would either block
 * the event loop or hand back a value that is not there yet.
 *
 * The honest form is to put the `await` in the caller's code, where the I/O is:
 *
 * ```ts
 * const author = await lazy(post).author;
 * ```
 *
 * The loader is reached only through `lazy(entity)`, never through a property
 * on the entity, so serializing or logging an entity cannot trigger a query.
 * Entities stay plain class instances with no `Proxy` around them.
 *
 * See `docs/product/lazy-loading-design.md`.
 */

/** Attached to a tracked entity at materialization; not a property of the model. */
const lazyLoaderKey = Symbol.for('entitykit.lazyLoader');

export interface LazyLoaderHost {
    /** Load `navigationProperty` and return its value, or throw explaining why it cannot. */
    loadNavigationLazily(entity: object, navigationProperty: string): Promise<unknown>;
    /** Navigation names configured on this entity, for validation and error messages. */
    navigationNamesFor(entity: object): readonly string[];
}

/**
 * Values on an entity that can be a navigation.
 *
 * `Date` and arrays of primitives are excluded: they are mapped columns, not
 * relationships. The runtime check is what actually decides — this only keeps
 * obvious non-navigations out of completions.
 */
/** Navigation properties of `TEntity`, each awaitable. */
export type LazyNavigations<TEntity extends object> = {
    readonly [K in keyof TEntity as
    NonNullable<TEntity[K]> extends ReadonlyArray<infer TElement>
        ? TElement extends Date ? never : TElement extends object ? K : never
        : NonNullable<TEntity[K]> extends Date ? never
            : NonNullable<TEntity[K]> extends (...args: never[]) => unknown
                ? never
                : NonNullable<TEntity[K]> extends object ? K : never]-?:
    Promise<NonNullable<TEntity[K]>>;
};

/**
 * Attach the loader that `lazy(entity)` reaches.
 *
 * Non-enumerable and symbol-keyed, so it survives neither `JSON.stringify` nor
 * object spread nor `Object.keys` — an entity carrying one is indistinguishable
 * from one that does not, except through `lazy`.
 */
export function attachLazyLoader(entity: object, host: LazyLoaderHost): void {
    if (Object.prototype.hasOwnProperty.call(entity, lazyLoaderKey)) {
        (entity as Record<symbol, unknown>)[lazyLoaderKey] = host;
        return;
    }

    Object.defineProperty(entity, lazyLoaderKey, {
        value: host,
        enumerable: false,
        configurable: true,
        writable: true,
    });
}

export function detachLazyLoader(entity: object): void {
    if (Object.prototype.hasOwnProperty.call(entity, lazyLoaderKey)) {
        Reflect.deleteProperty(entity, lazyLoaderKey);
    }
}

export function lazyLoaderOf(entity: object): LazyLoaderHost | undefined {
    return (entity as Record<symbol, LazyLoaderHost | undefined>)[lazyLoaderKey];
}

/**
 * Awaitable access to an entity's navigation properties.
 *
 * Awaiting also assigns the value onto the entity, so `post.author` reads
 * normally afterwards — the same end state `include(...)` produces. A
 * navigation already loaded resolves from memory without a query.
 *
 * ```ts
 * const author = await lazy(post).author;
 * const comments = await lazy(post).comments;
 * ```
 */
export function lazy<TEntity extends object>(entity: TEntity): LazyNavigations<TEntity> {
    const candidate: unknown = entity;
    if (candidate === null || typeof candidate !== 'object') {
        throw new Error('lazy(...) requires an entity instance.');
    }

    const host = lazyLoaderOf(entity);
    if (!host) {
        throw new Error(
            'lazy(...) needs an entity tracked by a DbContext with lazy loading enabled. ' +
      'Call options.useLazyLoading() in configure(), and load the entity through the context rather than constructing it.',
        );
    }

    const entityName = entity.constructor.name || 'entity';

    return new Proxy(Object.create(null) as LazyNavigations<TEntity>, {
        get(_target, property): unknown {
            if (typeof property !== 'string') {
                return undefined;
            }

            const navigations = host.navigationNamesFor(entity);
            if (!navigations.includes(property)) {
                throw new Error(
                    `'${property}' is not a navigation property on '${entityName}'. ` +
          `Configured navigations: ${navigations.length > 0 ? navigations.map(name => `'${name}'`).join(', ') : 'none'}.`,
                );
            }

            return host.loadNavigationLazily(entity, property);
        },
        has(_target, property) {
            return typeof property === 'string' && host.navigationNamesFor(entity).includes(property);
        },
        ownKeys() {
            return [...host.navigationNamesFor(entity)];
        },
        getOwnPropertyDescriptor(_target, property) {
            return typeof property === 'string' && host.navigationNamesFor(entity).includes(property)
                ? { enumerable: true, configurable: true }
                : undefined;
        },
    });
}
