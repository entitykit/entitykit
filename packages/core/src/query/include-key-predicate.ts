import { QueryCompilationError } from '../errors/query-errors';
import { FieldExpression } from './expression/field-expression';
import type { PredicateExpression } from './expression/predicate-expression';

/** Pair adjacent terms so traversal depth grows logarithmically; keep bind order. */
export function combineIncludeKeyTerms<T>(terms: readonly T[], combine: (left: T, right: T) => T): T {
    if (terms.length === 0) throw new QueryCompilationError('An include key predicate requires at least one term.');
    let layer = terms;
    while (layer.length > 1) {
        const next: T[] = [];
        for (let index = 0; index < layer.length; index += 2) {
            next.push(index + 1 < layer.length ? combine(layer[index], layer[index + 1]) : layer[index]);
        }
        layer = next;
    }
    return layer[0];
}

export function includeKeyPredicate(propertyNames: readonly string[], tuples: ReadonlyArray<readonly unknown[]>): PredicateExpression {
    if (propertyNames.length === 1) {
        return new FieldExpression(propertyNames[0] as never).in(tuples.map(tuple => tuple[0]));
    }
    const predicates = tuples.map(tuple => {
        const comparisons = propertyNames.map((propertyName, index) =>
            new FieldExpression(propertyName as never).eq(tuple[index] as never));
        return combineIncludeKeyTerms(comparisons, (left, right) => left.and(right));
    });
    return combineIncludeKeyTerms(predicates, (left, right) => left.or(right));
}
