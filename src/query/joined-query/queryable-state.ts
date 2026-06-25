import type { EntityMetadata } from '../../model/entity-metadata';
import type { QueryExecutor } from '../queryable-helpers';
import {
    cloneQueryModel,
    type QueryModel,
} from '../query-model';
import { snapshotJoinedQueryModel } from '../query-model-snapshot';
import type { JoinedQueryable } from './queryable';
import { createQueryPlan, type QueryPlan } from '../query-plan';
import type { DatabaseOperationOptions } from '../../storage/database-connection';

export class JoinedQueryableState<
    TRoot extends object,
    TJoined extends Record<string, object>,
    TProjectionJoined extends Record<string, object>,
> {
    constructor(
        protected readonly rootMetadata: EntityMetadata<TRoot>,
        protected readonly executor: QueryExecutor<TRoot>,
        protected readonly model: QueryModel<TRoot>,
    ) {}

    public async count(options?: DatabaseOperationOptions): Promise<number> {
        return this.executor.executeCount(this.toQueryModel(), options);
    }

    public async exists(options?: DatabaseOperationOptions): Promise<boolean> {
        return this.executor.executeExists(this.toQueryModel(), options);
    }

    public toQueryModel(): QueryModel<TRoot> {
        return snapshotJoinedQueryModel(this.model);
    }

    public toPlan(): QueryPlan {
        return createQueryPlan(this.model);
    }

    protected with(
        changes: Partial<Omit<QueryModel<TRoot>, 'entityType'>>,
    ): JoinedQueryable<TRoot, TJoined, TProjectionJoined> {
        return this.createQueryable<TJoined, TProjectionJoined>(
            cloneQueryModel(this.model, changes),
        );
    }

    protected createQueryable<
        TNextJoined extends Record<string, object>,
        TNextProjectionJoined extends Record<string, object>,
    >(
        model: QueryModel<TRoot>,
    ): JoinedQueryable<TRoot, TNextJoined, TNextProjectionJoined> {
        const Queryable = this.constructor as new (
            rootMetadata: EntityMetadata<TRoot>,
            executor: QueryExecutor<TRoot>,
            model: QueryModel<TRoot>
        ) => JoinedQueryable<TRoot, TNextJoined, TNextProjectionJoined>;

        return new Queryable(this.rootMetadata, this.executor, model);
    }

    protected joinAliases(): string[] {
        return this.model.joins.map(join => join.alias);
    }
}
