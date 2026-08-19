import type { IncludeExpression, IncludeFilterModel } from './query-model';

export interface UniqueObjectList {
    readonly items: object[];
    readonly seen: Set<object>;
}

export interface IncludeGroup<TEntity extends object> {
    readonly navigationProperty: string;
    readonly entityType?: [TEntity] extends [never] ? never : never;
    directFilter?: IncludeFilterModel;
    readonly children: IncludeExpression[];
}

export function groupIncludes<TEntity extends object>(
    includes: ReadonlyArray<IncludeExpression<TEntity>>,
): Array<IncludeGroup<TEntity>> {
    const groups: Map<string, IncludeGroup<TEntity>> = new Map();

    for (const include of includes) {
        const [navigationProperty, ...rest] = include.navigationPath.length > 0
            ? include.navigationPath
            : [include.navigationProperty as string];
        const group = groups.get(navigationProperty) ?? {
            navigationProperty,
            children: [],
        };

        if (rest.length === 0) {
            group.directFilter = include.filter;
        } else {
            group.children.push({
                navigationProperty: rest[0] as never,
                navigationPath: rest,
                filter: include.filter,
            });
        }

        groups.set(navigationProperty, group);
    }

    return Array.from(groups.values());
}

export function uniqueEntityInstances<TEntity extends object>(
    entities: readonly TEntity[],
): TEntity[] {
    return Array.from(new Set(entities));
}

export function pushUnique<TEntity extends object>(
    items: TEntity[],
    item: TEntity,
): void {
    if (!items.includes(item)) {
        items.push(item);
    }
}

export function getUniqueObjectList<TKey>(
    map: Map<TKey, UniqueObjectList>,
    key: TKey,
): UniqueObjectList {
    const existing = map.get(key);
    if (existing) {
        return existing;
    }

    const created = { items: [], seen: new Set<object>() };
    map.set(key, created);
    return created;
}

export function pushUniqueObject(
    list: UniqueObjectList,
    item: object,
): void {
    if (list.seen.has(item)) {
        return;
    }

    list.seen.add(item);
    list.items.push(item);
}
