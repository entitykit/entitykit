import type { DatabaseConnection, DatabaseOperationOptions } from '../storage/database-connection';
import type { StoreValueReader } from '../storage/store-value-reader';
import type { ChangeTracker } from '../tracking/change-tracker';
import type { EntityMetadata } from '../model/entity-metadata';
import type { Model } from '../model/model';
import type { ManyToManyMetadata } from '../model/many-to-many-metadata';
import type { SqlDialect } from '../sql/sql-dialect';
import type { SelectSqlBuilder } from '../sql/select-sql-builder';
import type { Materializer } from '../materialization/materializer';
import type { IncludeDiagnosticEvent } from '../diagnostics/runtime/events';
import type { NavigationWriter } from '../tracking/navigation-writer';
import type { NavigationLoadTrackerJournal } from '../tracking/navigation-load-tracker-journal';
import type { QueryModel } from './query-model';

/**
 * Shared contracts for the include-loading collaborators.
 *
 * Eager loading is split across several single-purpose modules
 * (`IncludeLoaderStrategies`, `IncludeLoaderKeyBatch`, `IncludeLoaderStitch`),
 * and each one needs the same injected services plus the small value types they
 * hand back and forth. Those live here so no collaborator has to import a peer
 * merely to name a shared shape, and so the dependency bundle is a read-only
 * value object every collaborator can lean on rather than a back-reference into
 * `IncludeLoader` itself.
 */

export type QueryFilterApplier = <TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    query: QueryModel<TEntity>,
) => QueryModel<TEntity>;

export interface LoadedIncludeResult<TEntity extends object = object> {
    readonly metadata: EntityMetadata<TEntity>;
    readonly roots: ReadonlyArray<IncludeLoadRoot<TEntity>>;
}

/** One navigation root paired with values captured once for this load. */
export interface IncludeLoadRoot<TEntity extends object = object> {
    readonly entity: TEntity;
    readonly values: Readonly<Record<string, unknown>>;
    readonly boundValues: Readonly<Record<string, unknown>>;
}

export interface ManyToManyRelationshipInfo {
    readonly currentMetadata: EntityMetadata;
    readonly relatedMetadata: EntityMetadata;
    readonly sourceMetadata: EntityMetadata;
    readonly relationship: ManyToManyMetadata;
    readonly navigationProperty: string;
    readonly currentJoinColumns: readonly string[];
    readonly relatedJoinColumns: readonly string[];
    readonly relatedInverseNavigationProperty?: string;
}

/**
 * The services every include collaborator shares. `IncludeLoader` builds it
 * once and passes it by reference; the fields are read-only so a collaborator
 * can depend on the bundle without being able to reach back and mutate the
 * loader that owns it.
 */
export interface IncludeLoaderContext {
    readonly model: Model;
    readonly database: DatabaseConnection;
    readonly operationOptions?: DatabaseOperationOptions;
    readonly changeTracker: ChangeTracker;
    /** Journals every graph write so a failed include can unwind the stitch. */
    readonly journal: NavigationWriter;
    /** Records the tracker facts a failed include has to hand back. */
    readonly trackerJournal: NavigationLoadTrackerJournal;
    readonly fixupTrackedGraph: boolean;
    readonly preservePendingRelationships: boolean;
    readonly applyQueryFilters?: QueryFilterApplier;
    readonly dialect: SqlDialect;
    readonly diagnostics?: (event: Omit<IncludeDiagnosticEvent, 'kind' | 'provider'>) => void;
    readonly valueReader?: StoreValueReader;
    readonly selectSql: SelectSqlBuilder;
    readonly materializer: Materializer;
}
