/** A composable SQL predicate produced by query-field operators. */
export interface PredicateExpression {
    /** Require both SQL predicates to match. Does not execute SQL. */ and(other: PredicateExpression): PredicateExpression;
    /** Match either SQL predicate. Does not execute SQL. */ or(other: PredicateExpression): PredicateExpression;
    /** Negate this SQL predicate. Does not execute SQL. */ not(): PredicateExpression;
}

/** A composable SQL HAVING predicate produced by aggregate-field operators. */
export interface HavingPredicateExpression {
    /** Require both SQL predicates to match. Does not execute SQL. */ and(other: HavingPredicateExpression): HavingPredicateExpression;
    /** Match either SQL predicate. Does not execute SQL. */ or(other: HavingPredicateExpression): HavingPredicateExpression;
    /** Negate this SQL predicate. Does not execute SQL. */ not(): HavingPredicateExpression;
}
