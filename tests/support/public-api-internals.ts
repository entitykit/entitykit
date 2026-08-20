import type { DbSet } from '../../packages/core/src/core/db-set-types';
import type { DbContextOptions } from '../../packages/core/src/core/context-options/db-context-option-types';
import type { EntityMetadata } from '../../packages/core/src/model/entity-metadata';
import type { Model } from '../../packages/core/src/model/model';
import type { ChangeTracker as ChangeTrackerImplementation } from '../../packages/core/src/tracking/change-tracker';
import type { ChangeTracker } from '../../packages/core/src/tracking/change-tracker-types';
import type { EntityEntry as EntityEntryImplementation } from '../../packages/core/src/tracking/entity-entry';
import type { EntityEntry } from '../../packages/core/src/tracking/entity-entry-types';
import {
    internalChangeTracker as unwrapChangeTracker,
} from '../../packages/core/src/tracking/public-change-tracker';
import {
    internalEntityEntry as unwrapEntityEntry,
} from '../../packages/core/src/tracking/public-entity-entry';

/** Test-only access to metadata intentionally hidden from the application API. */
export function setMetadata<TEntity extends object>(set: DbSet<TEntity>): EntityMetadata<TEntity> {
    return (set as DbSet<TEntity> & {
        readonly metadata: EntityMetadata<TEntity>;
    }).metadata;
}

/** Test-only access to runtime options intentionally hidden from applications. */
export function contextOptions(context: object): DbContextOptions {
    return contextHost(context).options;
}

/** Test-only access to mutable runtime metadata intentionally hidden from applications. */
export function contextModel(context: object): Model {
    return contextHost(context).modelMetadata;
}

/** Test-only access to identity-map operations hidden from applications. */
export function internalChangeTracker(tracker: ChangeTracker): ChangeTrackerImplementation {
    return unwrapChangeTracker(tracker);
}

/** Test-only access to tracked-entry bookkeeping hidden from applications. */
export function internalEntityEntry<TEntity extends object>(
    entry: EntityEntry<TEntity>,
): EntityEntryImplementation<TEntity> {
    return unwrapEntityEntry(entry);
}

function contextHost(context: object): {
    readonly options: DbContextOptions;
    readonly modelMetadata: Model;
} {
    return (context as {
        readonly contextHost: {
            readonly options: DbContextOptions;
            readonly modelMetadata: Model;
        };
    }).contextHost;
}
