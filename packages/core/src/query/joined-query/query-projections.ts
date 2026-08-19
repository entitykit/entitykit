import {
    createAggregateExpressions,
    createAggregateProxy,
    createGroupKeyExpressions,
    type AggregateProxy,
    type AggregateResult,
    type AggregateSelection,
    type GroupKeyResult,
    type GroupKeySelection,
} from '../aggregate';
import { JoinedAggregateProjectedQueryable } from '../joined-query-aggregate';
import { JoinedGroupedQueryable } from '../joined-query-grouped';
import {
    createJoinedProjectionProxy,
    createJoinedQueryProxy,
    type JoinedProjectionProxy,
    type JoinedQueryProxy,
} from '../joined-query-proxy';
import { JoinedProjectedQueryable } from '../joined-query-projected';
import {
    createProjectionBuilder,
    createProjectionExpression,
    type ProjectionBuilder,
    type ProjectionResult,
    type ProjectionSelection,
} from '../projection';
import { cloneQueryModel } from '../query-model';
import { JoinedQueryFilters } from './query-filters';

export class JoinedQueryProjections<
    TRoot extends object,
    TJoined extends Record<string, object>,
    TProjectionJoined extends Record<string, object>,
> extends JoinedQueryFilters<TRoot, TJoined, TProjectionJoined> {
    public select<TSelection extends ProjectionSelection>(
        selector: (
            sources: JoinedProjectionProxy<TRoot, TProjectionJoined>,
            project: ProjectionBuilder,
        ) => TSelection,
    ): JoinedProjectedQueryable<TRoot, TJoined, ProjectionResult<TSelection>> {
        const projection = createProjectionExpression(selector(
            createJoinedProjectionProxy<TRoot, TProjectionJoined>(
                this.joinAliases(),
            ),
            createProjectionBuilder(),
        ));
        return new JoinedProjectedQueryable(
            this.rootMetadata,
            this.executor,
            cloneQueryModel(this.model, { projection }),
        );
    }

    public aggregate<TSelection extends AggregateSelection>(
        selector: (
            aggregate: AggregateProxy<
                TRoot,
                JoinedQueryProxy<TRoot, TProjectionJoined>
            >,
        ) => TSelection,
    ): JoinedAggregateProjectedQueryable<TRoot, AggregateResult<TSelection>> {
        const aggregateProjection = createAggregateExpressions(
            selector(createAggregateProxy<
                TRoot,
                JoinedQueryProxy<TRoot, TProjectionJoined>
            >(
                createJoinedQueryProxy<TRoot, TProjectionJoined>(this.joinAliases()),
            )),
        );
        return new JoinedAggregateProjectedQueryable(
            this.rootMetadata,
            this.executor,
            cloneQueryModel(this.model, { aggregateProjection }),
        );
    }

    public groupBy<TSelection extends GroupKeySelection>(
        selector: (
            sources: JoinedQueryProxy<TRoot, TProjectionJoined>,
        ) => TSelection,
    ): JoinedGroupedQueryable<
        TRoot,
        TProjectionJoined,
        GroupKeyResult<TSelection>
    > {
        const groupKeys = createGroupKeyExpressions(
            selector(
                createJoinedQueryProxy<TRoot, TProjectionJoined>(this.joinAliases()),
            ),
        );
        return new JoinedGroupedQueryable(
            this.rootMetadata,
            this.executor,
            cloneQueryModel(this.model, { groupKeys }),
        );
    }
}
