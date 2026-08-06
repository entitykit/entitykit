import type { DatabaseConnection, DatabaseOperationOptions } from '../storage/database-connection';
import type { StoreValueReader } from '../storage/store-value-reader';
import type { ChangeTracker } from '../tracking/change-tracker';
import type { EntityMetadata } from '../model/entity-metadata';
import type { Model } from '../model/model';
import type { IncludeExpression } from './query-model';
import { postgresDialect, type SqlDialect } from '../sql/sql-dialect';
import { SelectSqlBuilder } from '../sql/select-sql-builder';
import { Materializer } from '../materialization/materializer';
import type { IncludeDiagnosticEvent } from '../diagnostics/runtime/events';
import type { QueryFilterApplier } from './include-loader-context';
import { IncludeStrategyRunner } from './include-loader-strategies';
import { groupIncludes } from './include-navigation-helpers';
import { captureIncludeRoots } from './include-load-root';

/**
 * Eager relationship/navigation loading for `include(...)`.
 *
 * The loader is the public seam over a set of single-responsibility
 * collaborators: `IncludeStrategyRunner` picks and runs the per-kind load
 * strategy (delegating key batching to `IncludePropertyLoader` and result
 * assignment to `IncludeStitcher`), all sharing the read-only
 * `IncludeLoaderContext` this class assembles. `IncludeLoader` itself keeps only
 * the recursion over the include tree, so the class stays the stable, published
 * entry point while its internals decompose behind it.
 */
export class IncludeLoader {
    private readonly strategies: IncludeStrategyRunner;

    constructor(
        model: Model,
        database: DatabaseConnection,
        changeTracker: ChangeTracker,
        applyQueryFilters?: QueryFilterApplier,
        dialect: SqlDialect = postgresDialect,
        diagnostics?: (event: Omit<IncludeDiagnosticEvent, 'kind' | 'provider'>) => void,
        valueReader?: StoreValueReader,
        operationOptions?: DatabaseOperationOptions,
    ) {
        this.strategies = new IncludeStrategyRunner({
            model,
            database,
            operationOptions,
            changeTracker,
            applyQueryFilters,
            dialect,
            diagnostics,
            valueReader,
            selectSql: new SelectSqlBuilder(dialect),
            materializer: new Materializer(valueReader),
        });
    }

    public async load<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        entities: readonly TEntity[],
        includes: ReadonlyArray<IncludeExpression<TEntity>>,
        suppliedValues?: ReadonlyMap<
            object,
            Readonly<Record<string, unknown>>
        >,
    ): Promise<void> {
        if (entities.length === 0 || includes.length === 0) {
            return;
        }

        const roots = captureIncludeRoots(metadata, entities, suppliedValues);
        for (const group of groupIncludes(includes)) {
            const loaded = await this.strategies.loadDirectInclude(metadata, roots, group.navigationProperty, group.directFilter);
            if (loaded.entities.length > 0 && group.children.length > 0) {
                await this.load(loaded.metadata, loaded.entities, group.children);
            }
        }
    }
}
