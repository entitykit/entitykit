import { FieldExpression } from './expression/field-expression';
import { createQueryModel, cloneQueryModel, type IncludeFilterModel } from './query-model';
import type { EntityMetadata } from '../model/entity-metadata';
import type { IncludeLoaderContext } from './include-loader-context';

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
    ): Promise<TEntity[]> {
        const chunkSize = this.keyChunkSize(propertyNames.length, filter);
        if (tuples.length > chunkSize) {
            const loaded: TEntity[] = [];
            for (let start = 0; start < tuples.length; start += chunkSize) {
                loaded.push(...await this.loadByPropertyChunk(metadata, propertyNames, tuples.slice(start, start + chunkSize), filter));
            }
            return loaded;
        }

        return this.loadByPropertyChunk(metadata, propertyNames, tuples, filter);
    }

    /**
   * Parent keys that fit in one statement, or `Infinity` when the provider
   * declares no cap or the include's own window forbids splitting.
   */
    private keyChunkSize(propertiesPerTuple: number, filter?: IncludeFilterModel): number {
        const limit = this.ctx.dialect.maxStatementParameters?.();
        if (limit === undefined || filter?.limit !== undefined || filter?.offset !== undefined) {
            return Number.POSITIVE_INFINITY;
        }

        // Leave room for the parameters the include's own predicate contributes.
        const reserved = 64;
        return Math.max(Math.floor((limit - reserved) / Math.max(propertiesPerTuple, 1)), 1);
    }

    private async loadByPropertyChunk<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        propertyNames: readonly string[],
        tuples: ReadonlyArray<readonly unknown[]>,
        filter?: IncludeFilterModel,
    ): Promise<TEntity[]> {
    // One property keeps the compact `in (...)` form; several compile to an
    // `or` of `and`ed equality tests, one per key tuple.
        const basePredicate = propertyNames.length === 1
            ? new FieldExpression(propertyNames[0] as never).in(tuples.map(tuple => tuple[0]))
            : tuples
                .map(tuple => propertyNames
                    .map((propertyName, index) => new FieldExpression(propertyName as never).eq(tuple[index] as never))
                    .reduce((left, right) => left.and(right)))
                .reduce((left, right) => left.or(right));
        const predicate = filter?.predicate ? basePredicate.and(filter.predicate) : basePredicate;
        const query = cloneQueryModel(createQueryModel(metadata.ctor), {
            predicate,
            orderings: filter?.orderings,
            offset: filter?.offset,
            limit: filter?.limit,
        });
        const filteredQuery = this.ctx.applyQueryFilters ? this.ctx.applyQueryFilters(metadata, query) : query;
        const statement = this.ctx.selectSql.build(metadata, filteredQuery);
        const result = await this.ctx.database.query(
            statement,
            this.ctx.operationOptions,
        );
        return this.ctx.materializer.materializeMany(metadata, result.rows, this.ctx.changeTracker);
    }
}
