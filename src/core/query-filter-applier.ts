import type { EntityMetadata } from '../model/entity-metadata';
import { FieldExpression } from '../query/expression/field-expression';
import type { PredicateExpression } from '../query/expression/predicate-expression';
import { cloneQueryModel, type JoinExpression, type QueryModel } from '../query/query-model';
import type { RelationExistenceExpression } from '../query/relation-expression';

/**
 * Applies a context's implicit query filters — soft-delete and tenant scope —
 * to a query before it runs.
 *
 * This is a distinct concern from the unit-of-work hub: it rewrites a query's
 * predicate (and its joins and relation-existence subqueries) to fold in the
 * filters each source carries by default, and nothing about that touches
 * tracking, saving, or transactions. It reads only the model metadata and the
 * current tenant id, so the context hands it the tenant accessor as a closure.
 */
export class QueryFilterApplier {
    constructor(private readonly currentTenantId: () => unknown) {}

    public apply<TEntity extends object>(metadata: EntityMetadata<TEntity>, query: QueryModel<TEntity>): QueryModel<TEntity> {
        if (query.ignoreQueryFilters && query.ignoreTenantScope) {
            return query;
        }

        const opts = { softDelete: !query.ignoreQueryFilters, tenant: !query.ignoreTenantScope };
        let predicate = combinePredicates(query.predicate, this.filtersFor(metadata, undefined, opts));
        let joins: JoinExpression[] | undefined;
        let relationExistence: RelationExistenceExpression[] | undefined;

        for (let index = 0; index < query.joins.length; index += 1) {
            const join = query.joins[index];
            const filters = this.filtersFor(join.metadata, join.alias, opts);
            if (filters.length === 0) {
                continue;
            }

            if (join.kind === 'left') {
                joins ??= query.joins.map(item => ({ ...item }));
                const combinedPredicate = combinePredicates(
                    join.predicate,
                    filters,
                );
                if (!combinedPredicate) {
                    throw new Error(
                        'A filtered join must produce a predicate.',
                    );
                }
                joins[index] = {
                    ...join,
                    predicate: combinedPredicate,
                };
            } else {
                predicate = combinePredicates(predicate, filters);
            }
        }

        for (let index = 0; index < query.relationExistence.length; index += 1) {
            const expression = query.relationExistence[index];
            const filters = this.filtersFor(expression.relation.targetMetadata, undefined, opts);
            if (filters.length === 0) {
                continue;
            }

            relationExistence ??= query.relationExistence.map(item => ({ ...item }));
            relationExistence[index] = {
                ...expression,
                predicate: combinePredicates(expression.predicate, filters),
            };
        }

        if (predicate === query.predicate && !joins && !relationExistence) {
            return query;
        }

        return cloneQueryModel(query, {
            predicate,
            joins: joins ?? query.joins,
            relationExistence: relationExistence ?? query.relationExistence,
        });
    }

    /**
   * The filters a query carries implicitly.
   *
   * Soft delete and tenant scope are opted out of separately, because they are
   * not the same kind of thing: hiding deleted rows is a convenience, and
   * confining a query to one tenant is an isolation boundary. See
   * `Queryable.ignoreQueryFilters`.
   */
    private filtersFor<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        sourceAlias: string | undefined,
        applies: { softDelete: boolean; tenant: boolean },
    ): PredicateExpression[] {
        const filters: PredicateExpression[] = [];

        if (metadata.softDelete && applies.softDelete) {
            filters.push(new FieldExpression<TEntity, unknown>(metadata.softDelete.propertyName, sourceAlias).isNull());
        }

        const tenantId = this.currentTenantId();
        if (metadata.tenantKeyProperty && tenantId !== undefined && tenantId !== null && applies.tenant) {
            filters.push(new FieldExpression<TEntity, unknown>(metadata.tenantKeyProperty, sourceAlias).eq(tenantId));
        }

        return filters;
    }
}

function combinePredicates(
    initial: PredicateExpression | undefined,
    filters: readonly PredicateExpression[],
): PredicateExpression | undefined {
    return filters.reduce(
        (combined, filter) => combined ? combined.and(filter) : filter,
        initial,
    );
}
