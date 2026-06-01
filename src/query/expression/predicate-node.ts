/** Operators supported by value and field-comparison predicates. */
export type BinaryOperator =
  | 'eq'
  | 'ne'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'like'
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'in';

export type NullOperator = 'isNull' | 'isNotNull';
export type LogicalOperator = 'and' | 'or';

export type PredicateNode =
  | BinaryPredicateNode
  | FieldComparisonPredicateNode
  | NullPredicateNode
  | LogicalPredicateNode
  | NotPredicateNode;

export interface QueryFieldRef {
    readonly sourceAlias?: string;
    readonly propertyName: string;
}

export interface BinaryPredicateNode {
    readonly kind: 'binary';
    readonly operator: BinaryOperator;
    readonly sourceAlias?: string;
    readonly propertyName: string;
    readonly value: unknown;
}

export interface FieldComparisonPredicateNode {
    readonly kind: 'fieldComparison';
    readonly operator: 'eq' | 'ne';
    readonly left: QueryFieldRef;
    readonly right: QueryFieldRef;
}

export interface NullPredicateNode {
    readonly kind: 'null';
    readonly operator: NullOperator;
    readonly sourceAlias?: string;
    readonly propertyName: string;
}

export interface LogicalPredicateNode {
    readonly kind: 'logical';
    readonly operator: LogicalOperator;
    readonly left: PredicateNode;
    readonly right: PredicateNode;
}

export interface NotPredicateNode {
    readonly kind: 'not';
    readonly predicate: PredicateNode;
}
