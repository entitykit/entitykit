import type { EntityMetadata } from '../model/entity-metadata';
import { IncludeLoader } from '../query/include-loader';
import type { QueryModel } from '../query/query-model';
import type { DatabaseOperationOptions } from '../storage/database-connection';
import type { ChangeTracker } from '../tracking/change-tracker';
import {
    runNavigationLoadOperation,
} from '../tracking/navigation-load-operation';
import type { DbSetContext } from './db-set-context';
import type { DbSetDiagnostics } from './db-set-diagnostics';
import type { QueryFilterOperation } from './query-filter-operation';
import type { IncludeLoadRoot } from '../query/include-loader-context';

/**
 * Load one query's include graph through its immutable filter operation.
 *
 * The whole include tree is one failure-atomic operation: a refused navigation
 * unwinds every graph write already stitched for this query and detaches the
 * related entities it was the first to track, leaving the materialized roots
 * without a contradictory relationship graph. A `asNoTracking()` query stitches
 * into a throwaway tracker that is discarded either way, so its restoration
 * failures are not allowed to poison the context.
 */
export async function loadDbSetIncludes<TEntity extends object>(
    context: DbSetContext,
    diagnostics: DbSetDiagnostics<TEntity>,
    metadata: EntityMetadata<TEntity>,
    roots: ReadonlyArray<IncludeLoadRoot<TEntity>>,
    model: QueryModel<TEntity>,
    changeTracker: ChangeTracker,
    applyQueryFilters: QueryFilterOperation['apply'],
    options?: DatabaseOperationOptions,
): Promise<void> {
    const tracked = changeTracker === context.changeTracker;
    return runNavigationLoadOperation(
        changeTracker,
        error => {
            if (tracked) context.markStateRestorationFailure(error);
        },
        async journal => new IncludeLoader(
            context.modelMetadata,
            context.database,
            changeTracker,
            applyQueryFilters,
            context.dialect,
            event => {
                diagnostics.emitIncludeDiagnostic(event);
            },
            context.valueReader,
            options,
            tracked,
            tracked,
            journal,
        ).loadRoots(metadata, roots, model.includes),
    );
}
