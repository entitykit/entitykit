import type { QueryModel } from '../query/query-model';
import { QueryCompilationError } from '../errors/query-errors';

export function assertBulkMutationSupported<TEntity extends object>(
    model: QueryModel<TEntity>,
    label: string,
): void {
    if (!model.predicate) {
        throw new QueryCompilationError(
            `${label} requires a where(...) filter so it cannot rewrite the whole `
      + 'table by accident.',
        );
    }

    const unsupported: Array<[string, boolean]> = [
        ['include()', model.includes.length > 0],
        ['join()', model.joins.length > 0],
        ['whereHas()/whereDoesNotHave()', model.relationExistence.length > 0],
        ['select()', Boolean(model.projection)],
        ['groupBy()', Boolean(model.groupKeys)],
        ['aggregate()', Boolean(model.aggregateProjection)],
        ['orderBy()', model.orderings.length > 0],
        ['skip()', model.offset !== undefined],
        ['take()', model.limit !== undefined],
    ];
    const used = unsupported
        .filter(([, isUsed]) => isUsed)
        .map(([name]) => name);

    if (used.length > 0) {
        throw new QueryCompilationError(
            `${label} does not support ${used.join(', ')}. `
      + 'Use where(...) to select the rows to change.',
        );
    }
}
