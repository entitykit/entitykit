import type { ProjectionProxy } from './projection';
import type { QueryProxy } from './query-field-types';
import type { EntityConstructor } from '../types';

/** Nullable row shape produced by a left join. */
export type NullableProjectionEntity<TEntity extends object> = {
    readonly [K in keyof TEntity]: TEntity[K] | null;
};

/** Entity-set-like target accepted by join operations. */
export type JoinTarget<TEntity extends object> =
    | {
        /** Entity class identifying the joined set. */
        readonly entityType: EntityConstructor<TEntity>;
    }
    | {
        /** @deprecated Internal compatibility shape; application code passes a DbSet. */
        readonly metadata: {
            /** The ctor. */ readonly ctor: EntityConstructor<TEntity>;
        };
    };

/** Typed sources supplied to joined filter and ordering selectors. */
export type JoinedQueryProxy<
    TRoot extends object,
    TJoined extends Record<string, object>,
> = {
    /** The root. */ readonly root: QueryProxy<TRoot>;
} & {
    readonly [K in keyof TJoined]: QueryProxy<TJoined[K]>;
};

/** Typed sources supplied to joined projection selectors. */
export type JoinedProjectionProxy<
    TRoot extends object,
    TJoined extends Record<string, object>,
> = {
    /** The root. */ readonly root: ProjectionProxy<TRoot>;
} & {
    readonly [K in keyof TJoined]: ProjectionProxy<TJoined[K]>;
};
