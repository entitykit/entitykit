import { createQueryModel, cloneQueryModel, type IncludeFilterModel } from './query-model';
import type { EntityMetadata } from '../model/entity-metadata';
import type { IncludeLoaderContext, IncludeLoadRoot } from './include-loader-context';
import type { SqlStatement } from '../sql/sql-statement';
import { includeKeyPredicate } from './include-key-predicate';
import { includeKeyStatements } from './include-key-statements';
import { bindIncludeFilter } from './include-filter-bindings';

/**
 * Turn a set of parent-key tuples into materialized rows, split to stay within
 * the provider's statement-parameter cap.
 *
 * The parameter-budget arithmetic is a concern of its own: every loading
 * strategy needs "the rows for these keys", but none should have to repeat the
 * chunking or predicate assembly, so both live here and the strategies delegate
 * to a single instance.
 */
export class IncludePropertyLoader {
    constructor(private readonly ctx: IncludeLoaderContext) {}

    /**
   * Load related rows for a set of parent keys.
   *
   * The key list is EntityKit's own construction, not the caller's, so when it
   * would not fit in one statement it is split across several and the results
   * concatenated -- the same answer, from queries the provider will accept.
   * Splitting is skipped when the include carries a limit or offset, where the
   * window is defined over the whole result and chunking would change it.
   */
    public async loadByProperties<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        propertyNames: readonly string[],
        tuples: ReadonlyArray<readonly unknown[]>,
        filter?: IncludeFilterModel,
    ): Promise<Array<IncludeLoadRoot<TEntity>>> {
        if (tuples.length === 0) return [];
        const boundFilter = filter ? bindIncludeFilter(metadata, filter) : undefined;
        const build = (keys: ReadonlyArray<readonly unknown[]>): SqlStatement =>
            this.buildPropertyStatement(metadata, propertyNames, keys, boundFilter);
        // A bare limit/offset is a global window. Its callers use a single
        // parent's keys; only partitioned windows may split parent sets.
        const statements = filter?.limit !== undefined || filter?.offset !== undefined
            ? [build(tuples)]
            : includeKeyStatements(this.ctx.dialect, tuples, propertyNames.length, build);
        const loaded: Array<IncludeLoadRoot<TEntity>> = [];
        for (const statement of statements) {
            const result = await this.ctx.database.query(statement, this.ctx.operationOptions);
            for (const root of this.ctx.materializer.materializeManyWithValues(metadata, result.rows, this.ctx.changeTracker)) {
                loaded.push(root);
            }
        }
        return loaded;
    }

    private buildPropertyStatement<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        propertyNames: readonly string[],
        tuples: ReadonlyArray<readonly unknown[]>,
        filter?: IncludeFilterModel,
    ): SqlStatement {
        const basePredicate = includeKeyPredicate(propertyNames, tuples);
        const predicate = filter?.predicate ? basePredicate.and(filter.predicate) : basePredicate;
        const query = cloneQueryModel(createQueryModel(metadata.ctor), {
            predicate,
            orderings: filter?.orderings,
            offset: filter?.offset,
            limit: filter?.limit,
        });
        const filteredQuery = this.ctx.applyQueryFilters ? this.ctx.applyQueryFilters(metadata, query) : query;
        return this.ctx.selectSql.build(metadata, filteredQuery);
    }
}
