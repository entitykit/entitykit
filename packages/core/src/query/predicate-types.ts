/** A composable SQL predicate produced by query-field operators. */
export interface PredicateExpression {
    /** Perform the and operation. */ and(other: PredicateExpression): PredicateExpression;
    /** Perform the or operation. */ or(other: PredicateExpression): PredicateExpression;
    /** Perform the not operation. */ not(): PredicateExpression;
}

/** A composable SQL HAVING predicate produced by aggregate-field operators. */
export interface HavingPredicateExpression {
    /** Perform the and operation. */ and(other: HavingPredicateExpression): HavingPredicateExpression;
    /** Perform the or operation. */ or(other: HavingPredicateExpression): HavingPredicateExpression;
    /** Perform the not operation. */ not(): HavingPredicateExpression;
}
