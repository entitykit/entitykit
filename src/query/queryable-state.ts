import type { EntityMetadata } from '../model/entity-metadata';
import {
    createQueryModel,
    type IncludeExpression,
    type QueryModel,
} from './query-model';
import { snapshotQueryModel } from './query-model-snapshot';
import type { Queryable } from './queryable';
import { createQueryPlan, type QueryPlan } from './query-plan';
import {
    upsertInclude,
    type QueryExecutor,
} from './queryable-helpers';

export abstract class QueryableState<TEntity extends object> {
    constructor(
        public readonly metadata: EntityMetadata<TEntity>,
        protected readonly executor: QueryExecutor<TEntity>,
        protected readonly model: QueryModel<TEntity> =
            createQueryModel(metadata.ctor),
    ) {}

    public toQueryModel(): QueryModel<TEntity> {
        return snapshotQueryModel(this.model);
    }

    public toPlan(): QueryPlan {
        return createQueryPlan(this.model);
    }

    protected abstract with(
        changes: Partial<Omit<QueryModel<TEntity>, 'entityType'>>
    ): Queryable<TEntity>;

    protected withInclude(
        include: IncludeExpression<TEntity>,
    ): Queryable<TEntity> {
        const includes = upsertInclude(this.model.includes, include);
        return this.with({ includes });
    }
}
