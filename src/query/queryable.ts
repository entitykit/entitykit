import type { EntityMetadata } from '../model/entity-metadata';
import type { QueryProxy } from './query-field-types';
import { createQueryProxy } from './query-proxy';
import { cloneQueryModel, type IncludeExpression, type QueryModel } from './query-model';
import { createProjectionBuilder, createProjectionExpression, createProjectionProxy, type ProjectionBuilder, type ProjectionProxy, type ProjectionResult, type ProjectionSelection } from './projection';
import {
    createAggregateExpressions,
    createAggregateProxy,
    createGroupKeyExpressions,
    type AggregateProxy,
    type AggregateResult,
    type AggregateSelection,
    type GroupKeyResult,
    type GroupKeySelection,
} from './aggregate';
import {
    createIncludeProxy,
    IncludeNavigationExpression as IncludeNavigationExpressionValue,
} from './include-expression';
import type { IncludeNavigationExpression, IncludeProxy, NavigationElement } from './include-types';
import { ProjectedQueryable } from './queryable-projected';
import { AggregateProjectedQueryable } from './queryable-aggregate';
import { GroupedQueryable } from './queryable-grouped';
import type { QueryExecutor } from './queryable-helpers';
import { QueryableJoins } from './queryable-joins';

// The projection, grouped, aggregate, and terminal builders live in their own
// files for cohesion, but remain part of this module's public surface:
// `src/index.ts` and existing consumers (`DbSet`, tests) import the builders —
// and `QueryExecutor` — by name from "./query/queryable", so the frozen surface
// is preserved by re-exporting them here rather than pointing every importer at
// the new files. The shared query-building and execution methods live on the
// abstract `QueryableBase`/`QueryableTerminals`; the api-surface generator
// counts inherited members, so `Queryable`'s public surface is unchanged.
export { AggregateProjectedQueryable, GroupedQueryable, ProjectedQueryable };
export type { QueryExecutor };

/**
 * Immutable query builder for an entity type.
 *
 * Query methods return a new `Queryable`; call an execution method such as
 * `toArray()`, `single()`, or `count()` to run SQL.
 *
 * The same-shape refinements (`where`, `orderBy`, paging, …) and the terminal
 * reads are inherited from `QueryableBase`/`QueryableTerminals`. This concrete
 * class adds the shape-*changing* builders — `select`, `aggregate`, `groupBy`,
 * the joins, and `include` — each of which returns a different builder type,
 * plus the `with()` factory that is the one place a `Queryable` value is
 * constructed. Keeping that factory here, below the base in the module graph,
 * is what lets `IncludeQueryable extends Queryable` avoid a load-time cycle.
 */
export class Queryable<TEntity extends object> extends QueryableJoins<TEntity> {
    /**
   * Include a related navigation using split-query loading.
   */
    public include<TNavigation>(
        selector: (entity: IncludeProxy<TEntity>) => IncludeNavigationExpression<TEntity, TNavigation>,
    ): IncludeQueryable<TEntity, NavigationElement<TNavigation>> {
        const expression = selector(createIncludeProxy<TEntity>());
        assertIncludeExpression(expression);
        const include = expression.toIncludeExpression();
        const query = this.withInclude(include);
        return new IncludeQueryable<TEntity, NavigationElement<TNavigation>>(
            this.metadata,
            this.executor,
            query.toQueryModel(),
            include.navigationPath,
        );
    }

    /**
   * Project selected fields instead of materializing tracked entities.
   */
    public select<TSelection extends ProjectionSelection>(
        selector: (entity: ProjectionProxy<TEntity>, project: ProjectionBuilder) => TSelection,
    ): ProjectedQueryable<TEntity, ProjectionResult<TSelection>> {
        const projection = createProjectionExpression(selector(createProjectionProxy<TEntity>(), createProjectionBuilder()));
        return new ProjectedQueryable<TEntity, ProjectionResult<TSelection>>(
            this.metadata,
            this.executor,
            this.with({ projection }).toQueryModel(),
        );
    }

    public aggregate<TSelection extends AggregateSelection>(
        selector: (aggregate: AggregateProxy<TEntity>) => TSelection,
    ): AggregateProjectedQueryable<TEntity, AggregateResult<TSelection>> {
        const aggregateProjection = createAggregateExpressions(selector(createAggregateProxy<TEntity>()));
        return new AggregateProjectedQueryable<TEntity, AggregateResult<TSelection>>(
            this.metadata,
            this.executor,
            this.with({ aggregateProjection }).toQueryModel(),
        );
    }

    public groupBy<TSelection extends GroupKeySelection>(
        selector: (entity: QueryProxy<TEntity>) => TSelection,
    ): GroupedQueryable<TEntity, GroupKeyResult<TSelection>> {
        const groupKeys = createGroupKeyExpressions(selector(createQueryProxy<TEntity>()));
        return new GroupedQueryable<TEntity, GroupKeyResult<TSelection>>(
            this.metadata,
            this.executor,
            this.with({ groupKeys }).toQueryModel(),
        );
    }

    protected with(changes: Partial<Omit<QueryModel<TEntity>, 'entityType'>>): Queryable<TEntity> {
        return new Queryable(this.metadata, this.executor, cloneQueryModel(this.model, changes));
    }
}

export class IncludeQueryable<TEntity extends object, TCurrent extends object> extends Queryable<TEntity> {
    constructor(
        metadata: EntityMetadata<TEntity>,
        executor: QueryExecutor<TEntity>,
        model: QueryModel<TEntity>,
        private readonly currentIncludePath: readonly string[],
    ) {
        super(metadata, executor, model);
    }

    public thenInclude<TNavigation>(
        selector: (entity: IncludeProxy<TCurrent>) => IncludeNavigationExpression<TCurrent, TNavigation>,
    ): IncludeQueryable<TEntity, NavigationElement<TNavigation>> {
        const expression = selector(createIncludeProxy<TCurrent>());
        assertIncludeExpression(expression);
        const path = [...this.currentIncludePath, ...expression.navigationPath];
        const include = expression.toIncludeExpression(path) as unknown as IncludeExpression<TEntity>;
        const query = this.withInclude(include);
        return new IncludeQueryable<TEntity, NavigationElement<TNavigation>>(
            this.metadata,
            this.executor,
            query.toQueryModel(),
            include.navigationPath,
        );
    }
}

function assertIncludeExpression<TEntity extends object>(
    expression: IncludeNavigationExpression<TEntity>,
): asserts expression is IncludeNavigationExpressionValue<TEntity> {
    if (!(expression instanceof IncludeNavigationExpressionValue)) {
        throw new Error(
            'include selectors must return a direct navigation expression.',
        );
    }
}
