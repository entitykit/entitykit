import type { QueryProxy } from './expression/query-field';
import { createProjectionProxy, type ProjectionProxy } from './projection';
import { createQueryProxy } from './query-proxy';
import type { EntityConstructor } from '../types';

export type NullableProjectionEntity<TEntity extends object> = {
    readonly [K in keyof TEntity]: TEntity[K] | null;
};

export type JoinTarget<TEntity extends object> =
    | { readonly entityType: EntityConstructor<TEntity> }
    | {
        readonly metadata: {
            readonly ctor: EntityConstructor<TEntity>;
        };
    };

export type JoinedQueryProxy<
    TRoot extends object,
    TJoined extends Record<string, object>,
> = {
    readonly root: QueryProxy<TRoot>;
} & {
    readonly [K in keyof TJoined]: QueryProxy<TJoined[K]>;
};

export type JoinedProjectionProxy<
    TRoot extends object,
    TJoined extends Record<string, object>,
> = {
    readonly root: ProjectionProxy<TRoot>;
} & {
    readonly [K in keyof TJoined]: ProjectionProxy<TJoined[K]>;
};

export function createJoinedQueryProxy<
    TRoot extends object,
    TJoined extends Record<string, object>,
>(aliases: readonly string[]): JoinedQueryProxy<TRoot, TJoined> {
    const allowedAliases = new Set(['root', ...aliases]);
    return new Proxy({}, {
        get(_target, propertyKey): QueryProxy<object> {
            if (typeof propertyKey !== 'string') {
                throw new Error(
                    'Joined query selectors must access string-named sources.',
                );
            }

            if (!allowedAliases.has(propertyKey)) {
                throw new Error(
                    `Joined query source '${propertyKey}' has not been joined.`,
                );
            }

            return createQueryProxy<object>(propertyKey);
        },
    }) as JoinedQueryProxy<TRoot, TJoined>;
}

export function createJoinedProjectionProxy<
    TRoot extends object,
    TJoined extends Record<string, object>,
>(aliases: readonly string[]): JoinedProjectionProxy<TRoot, TJoined> {
    const allowedAliases = new Set(['root', ...aliases]);
    return new Proxy({}, {
        get(_target, propertyKey): ProjectionProxy<object> {
            if (typeof propertyKey !== 'string') {
                throw new Error(
                    'Joined projection selectors must access string-named sources.',
                );
            }

            if (!allowedAliases.has(propertyKey)) {
                throw new Error(
                    `Joined projection source '${propertyKey}' has not been joined.`,
                );
            }

            return createProjectionProxy<object>(propertyKey);
        },
    }) as JoinedProjectionProxy<TRoot, TJoined>;
}
