import { IncludeLoader } from '../query/include-loader';
import type { QueryModel } from '../query/query-model';
import type { EntityMetadata } from '../model/entity-metadata';
import type { EntityEntry } from '../tracking/entity-entry';
import { QueryFilterApplier } from './query-filter-applier';
import { DbContextConcurrency } from './db-context-concurrency';
import { assertNavigationLoadableEntry } from './navigation-load-guard';

/** Query filters and explicit navigation loading for a context. */
export abstract class DbContextQuery extends DbContextConcurrency {
    private readonly queryFilters = new QueryFilterApplier(
        () => this.currentTenantId(),
        () => this.options.tenantScope?.allowCrossTenantAccess === true,
    );

    public override async loadNavigation<TEntity extends object>(
        entry: EntityEntry<TEntity>,
        navigationProperty: string,
    ): Promise<unknown> {
        assertNavigationLoadableEntry(this.changeTracker, entry);
        const loader = new IncludeLoader(
            this.modelMetadata,
            this.databaseConnection,
            this.changeTracker,
            (metadata, query) => this.applyQueryFilters(metadata, query),
            this.dialect,
            undefined,
            this.valueReader,
        );
        await loader.load(entry.metadata, [entry.entity], [{
            navigationProperty: navigationProperty as never,
            navigationPath: [navigationProperty],
        }]);
        return (entry.entity as Record<string, unknown>)[navigationProperty];
    }

    public override applyQueryFilters<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        query: QueryModel<TEntity>,
    ): QueryModel<TEntity> {
        return this.queryFilters.apply(metadata, query);
    }
}
