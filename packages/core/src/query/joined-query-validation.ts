import { HavingPredicateExpression } from './aggregate';
import { PredicateExpression } from './expression/predicate-expression';

export function validateJoinAlias(
    alias: string,
    existingAliases: readonly string[] = [],
): void {
    if (alias.length === 0) {
        throw new Error('Join alias must be a non-empty string.');
    }

    if (alias === 'root') {
        throw new Error('Join alias \'root\' is reserved for the root query source.');
    }

    if (existingAliases.includes(alias)) {
        throw new Error(`Join alias '${alias}' is already used in this query.`);
    }
}

export function assertJoinPredicate(
    value: unknown,
): asserts value is PredicateExpression {
    if (!value || typeof value !== 'object' || !('node' in value)) {
        throw new Error('join selectors must return a predicate expression.');
    }
}

export function assertPredicateExpression(
    value: unknown,
    operation: string,
): asserts value is PredicateExpression {
    if (!(value instanceof PredicateExpression)) {
        throw new Error(
            `${operation} must return a predicate expression. Use field operators such as eq(), ne(), in(), isNull(), like(), or combine predicates with and()/or().`,
        );
    }
}

export function assertHavingPredicateExpression(
    value: unknown,
    operation: string,
): asserts value is HavingPredicateExpression {
    if (!(value instanceof HavingPredicateExpression)) {
        throw new Error(
            `${operation} must return a having predicate expression.`,
        );
    }
}

export function assertNonNegativeInteger(
    value: number,
    operation: string,
): void {
    if (!Number.isInteger(value) || value < 0) {
        throw new Error(
            `${operation} count must be a non-negative integer.`,
        );
    }
}
