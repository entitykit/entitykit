import type { EntityMetadata } from '../../model/entity-metadata';
import type { PredicateExpression } from '../predicate-types';
import {
    createJoinedQueryProxy,
} from '../joined-query-proxy';
import type {
    JoinedQueryProxy,
    JoinTarget,
    NullableProjectionEntity,
} from '../joined-proxy-types';
import {
    assertJoinPredicate,
    validateJoinAlias,
} from '../joined-query-validation';
import type { JoinKind } from '../query-model';
import { cloneJoin, cloneQueryModel, type JoinExpression } from '../query-model';
import { JoinedQueryProjections } from './query-projections';

export class JoinedQueryable<
    TRoot extends object,
    TJoined extends Record<string, object>,
    TProjectionJoined extends Record<string, object> = TJoined,
> extends JoinedQueryProjections<TRoot, TJoined, TProjectionJoined> {
    public join<TAlias extends string, TEntity extends object>(
        alias: TAlias,
        target: JoinTarget<TEntity>,
        selector: (
            sources: JoinedQueryProxy<
                TRoot,
        TJoined & Record<TAlias, TEntity>
            >,
        ) => PredicateExpression,
    ): JoinedQueryable<
        TRoot,
    TJoined & Record<TAlias, TEntity>,
    TProjectionJoined & Record<TAlias, TEntity>
    > {
        return this.addJoin<TAlias, TEntity, TEntity>(
            alias, target, 'inner', selector,
        );
    }

    public leftJoin<TAlias extends string, TEntity extends object>(
        alias: TAlias,
        target: JoinTarget<TEntity>,
        selector: (
            sources: JoinedQueryProxy<
                TRoot,
        TJoined & Record<TAlias, TEntity>
            >,
        ) => PredicateExpression,
    ): JoinedQueryable<
        TRoot,
    TJoined & Record<TAlias, TEntity>,
    TProjectionJoined & Record<TAlias, NullableProjectionEntity<TEntity>>
    > {
        return this.addJoin<TAlias, TEntity, NullableProjectionEntity<TEntity>>(
            alias, target, 'left', selector,
        );
    }

    private addJoin<
        TAlias extends string,
        TEntity extends object,
        TProjectionEntity extends object,
    >(
        alias: TAlias,
        target: JoinTarget<TEntity>,
        kind: JoinKind,
        selector: (
            sources: JoinedQueryProxy<
                TRoot,
        TJoined & Record<TAlias, TEntity>
            >,
        ) => PredicateExpression,
    ): JoinedQueryable<
        TRoot,
    TJoined & Record<TAlias, TEntity>,
    TProjectionJoined & Record<TAlias, TProjectionEntity>
    > {
        validateJoinAlias(alias, this.joinAliases());
        const aliases = [...this.joinAliases(), alias];
        const predicate = selector(
            createJoinedQueryProxy<
                TRoot,
        TJoined & Record<TAlias, TEntity>
            >(aliases),
        );
        assertJoinPredicate(predicate);

        const join: JoinExpression = {
            alias,
            metadata: readJoinTargetMetadata(target),
            kind,
            predicate,
        };
        return this.createQueryable<
      TJoined & Record<TAlias, TEntity>,
      TProjectionJoined & Record<TAlias, TProjectionEntity>
        >(cloneQueryModel(this.model, {
            joins: [...this.model.joins.map(item => cloneJoin(item)), join],
        }));
    }
}

function readJoinTargetMetadata<TEntity extends object>(
    target: JoinTarget<TEntity>,
): EntityMetadata {
    const metadata = (target as unknown as {
        readonly metadata?: EntityMetadata<TEntity>;
    }).metadata;
    if (!metadata) {
        throw new TypeError('Join targets must be EntityKit DbSet instances.');
    }
    return metadata as unknown as EntityMetadata;
}
