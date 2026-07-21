import type { PredicateExpression } from '../query/predicate-types';
import type { QueryProxy } from '../query/query-field-types';
import type { IncludeNavigationExpression, IncludeProxy, NavigationElement } from '../query/include-types';
import type { AggregateProjectedQueryable, GroupedQueryable, IncludeQueryable, ProjectedQueryable } from '../query/queryable';
import type {
    JoinedQueryProxy,
    JoinTarget,
    NullableProjectionEntity,
} from '../query/joined-proxy-types';
import type { JoinedQueryable } from '../query/joined-query/queryable';
import type { ProjectionBuilder, ProjectionProxy, ProjectionResult, ProjectionSelection } from '../query/projection';
import type { AggregateProxy, AggregateResult, AggregateSelection, GroupKeyResult, GroupKeySelection } from '../query/aggregate';
import { DbSetQueryRefinements } from './db-set-query-refinements';

/**
 * Shape-changing query builders exposed directly by every `DbSet`.
 *
 * Lookup, terminal reads, and same-shape refinements live on focused base
 * classes. `DbSet` still inherits the complete fluent surface, so its public
 * API remains unchanged.
 */
export abstract class DbSetQueryBuilder<
    TEntity extends object,
> extends DbSetQueryRefinements<TEntity> {
    /**
   * Include a related navigation using split-query loading.
   */
    public include<TNavigation>(
        selector: (entity: IncludeProxy<TEntity>) => IncludeNavigationExpression<TEntity, TNavigation>,
    ): IncludeQueryable<TEntity, NavigationElement<TNavigation>> {
        return this.query().include(selector);
    }

    public join<TAlias extends string, TJoined extends object>(
        alias: TAlias,
        target: JoinTarget<TJoined>,
        selector: (sources: JoinedQueryProxy<TEntity, Record<TAlias, TJoined>>) => PredicateExpression,
    ): JoinedQueryable<TEntity, Record<TAlias, TJoined>, Record<TAlias, TJoined>> {
        return this.query().join(alias, target, selector);
    }

    public leftJoin<TAlias extends string, TJoined extends object>(
        alias: TAlias,
        target: JoinTarget<TJoined>,
        selector: (sources: JoinedQueryProxy<TEntity, Record<TAlias, TJoined>>) => PredicateExpression,
    ): JoinedQueryable<TEntity, Record<TAlias, TJoined>, Record<TAlias, NullableProjectionEntity<TJoined>>> {
        return this.query().leftJoin(alias, target, selector);
    }

    /**
   * Select projected fields instead of full tracked entities.
   */
    public select<TSelection extends ProjectionSelection>(
        selector: (
            entity: ProjectionProxy<TEntity>,
            project: ProjectionBuilder,
        ) => TSelection,
    ): ProjectedQueryable<TEntity, ProjectionResult<TSelection>> {
        return this.query().select(selector);
    }

    public aggregate<TSelection extends AggregateSelection>(
        selector: (aggregate: AggregateProxy<TEntity>) => TSelection,
    ): AggregateProjectedQueryable<TEntity, AggregateResult<TSelection>> {
        return this.query().aggregate(selector);
    }

    public groupBy<TSelection extends GroupKeySelection>(
        selector: (entity: QueryProxy<TEntity>) => TSelection,
    ): GroupedQueryable<TEntity, GroupKeyResult<TSelection>> {
        return this.query().groupBy(selector);
    }
}
