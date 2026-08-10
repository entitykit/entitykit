import type { EntityPropertyKey } from '../types';

const modelPropertyToken = Symbol('modelPropertyToken');
declare const modelPropertyType: unique symbol;
declare const modelPropertyPathType: unique symbol;
const modelPropertyPaths: WeakMap<object, readonly string[]> = new WeakMap();

/** Public contract for model property token. */ export interface ModelPropertyToken<TEntity extends object, TProperty = unknown> {
    /** The model property type. */ readonly [modelPropertyToken]: true;
    /** The model property type. */ readonly [modelPropertyType]?: [TProperty] extends [never] ? never : never;
    /** The property name. */ readonly propertyName: EntityPropertyKey<TEntity>;
}

/** Public contract for model property path token. */ export interface ModelPropertyPathToken<
    TEntity extends object,
    TProperty = unknown,
> {
    /** Compile-time entity/property types carried by this path token. */
    readonly [modelPropertyPathType]?: readonly [TEntity, TProperty];
}

/** Public type representing model property selector. */ export type ModelPropertySelector<TEntity extends object> = {
    readonly [K in EntityPropertyKey<TEntity>]:
    ModelPropertyToken<TEntity, TEntity[K]>;
};

/** Public type representing model property path selector. */ export type ModelPropertyPathSelector<
    TEntity extends object,
    TShape extends object = TEntity,
> = {
    readonly [K in EntityPropertyKey<TShape>]:
    ModelPropertyPathToken<TEntity, TShape[K]> &
    (NonNullable<TShape[K]> extends object
        ? ModelPropertyPathSelector<TEntity, NonNullable<TShape[K]>>
        : unknown);
};

/** Public type representing property selector. */ export type PropertySelector<TEntity extends object, TProperty = unknown> = (
    entity: ModelPropertySelector<TEntity>,
) => ModelPropertyToken<TEntity, TProperty>;

/** Public type representing property path selector. */ export type PropertyPathSelector<TEntity extends object, TProperty = unknown> = (
    entity: ModelPropertyPathSelector<TEntity>,
) => ModelPropertyPathToken<TEntity, TProperty>;

/** Public type representing property list selector. */ export type PropertyListSelector<TEntity extends object> = (
    entity: ModelPropertySelector<TEntity>,
) => ModelPropertyToken<TEntity> | ReadonlyArray<ModelPropertyToken<TEntity>>;

export function isModelPropertyToken<TEntity extends object>(value: unknown): value is ModelPropertyToken<TEntity> {
    return Boolean(
        value &&
        typeof value === 'object' &&
        (
            (value as Record<PropertyKey, unknown>)[modelPropertyToken] ===
                true ||
            (modelPropertyPaths.get(value)?.length ?? 0) > 0
        ),
    );
}

export function selectPropertyName<TEntity extends object, TProperty = unknown>(
    selector: PropertySelector<TEntity, TProperty>,
): EntityPropertyKey<TEntity> {
    const selected = selector(createModelPropertyProxy<TEntity>());
    if (!isModelPropertyToken<TEntity>(selected)) {
        throw new Error('Model property selector must return a direct property access, such as \'entity => entity.id\'.');
    }
    return selected.propertyName;
}

export function selectPropertyPath<
    TEntity extends object,
    TProperty = unknown,
>(
    selector:
        | PropertySelector<TEntity, TProperty>
        | PropertyPathSelector<TEntity, TProperty>,
): readonly string[] {
    const selected = (
        selector as (
            entity: ModelPropertyPathSelector<TEntity>,
        ) => unknown
    )(createModelPropertyPathProxy<TEntity>());
    const path = typeof selected === 'object' && selected !== null
        ? modelPropertyPaths.get(selected)
        : undefined;
    if (!path || path.length === 0) {
        throw new Error('Model property selector must return a direct property access, such as \'entity => entity.id\'.');
    }
    return path;
}

export function selectPropertyNames<TEntity extends object>(
    selector: PropertyListSelector<TEntity>,
): Array<EntityPropertyKey<TEntity>> {
    const selected = selector(createModelPropertyProxy<TEntity>());
    const tokens = Array.isArray(selected) ? selected : [selected];

    if (tokens.length === 0) {
        throw new Error('Model property selector must return at least one property.');
    }

    const propertyNames = tokens.map(token => {
        if (!isModelPropertyToken<TEntity>(token)) {
            throw new Error('Model property list selectors must return property accesses, such as \'entity => [entity.email, entity.name]\'.');
        }

        return token.propertyName;
    });

    return propertyNames;
}

function createModelPropertyPathProxy<TEntity extends object>(
    path: readonly string[] = [],
): ModelPropertyPathSelector<TEntity> {
    const proxy = new Proxy({}, {
        get(_target, property): unknown {
            if (typeof property !== 'string') {
                return undefined;
            }
            return createModelPropertyPathProxy<TEntity>([...path, property]);
        },
    }) as ModelPropertyPathSelector<TEntity>;
    modelPropertyPaths.set(proxy, path);
    return proxy;
}

function createModelPropertyProxy<TEntity extends object>(): ModelPropertySelector<TEntity> {
    return new Proxy({}, {
        get(_target, property): ModelPropertyToken<TEntity> {
            if (typeof property !== 'string') {
                throw new Error(
                    'Model property selectors must access a string property.',
                );
            }
            return {
                [modelPropertyToken]: true,
                propertyName: property as EntityPropertyKey<TEntity>,
            };
        },
    }) as ModelPropertySelector<TEntity>;
}
