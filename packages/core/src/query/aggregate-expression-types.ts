/**
 * Pure, serializable aggregate expression + HAVING predicate AST type
 * declarations — the wire shapes the runtime factories emit and the SQL layer
 * consumes.
 *
 * Kept free of any runtime code so it stays a leaf that both the field/proxy
 * type module and every runtime builder can import without pulling in a
 * factory (and without an import cycle).
 */

import type {
    BinaryOperator,
    LogicalOperator,
    NullOperator,
} from './expression/predicate-node';
import type { SortDirection } from './expression/order-expression';

/** Public type representing aggregate function. */ export type AggregateFunction = 'count' | 'sum' | 'avg' | 'min' | 'max';
/** Public type representing date bucket precision. */ export type DateBucketPrecision = 'hour' | 'day' | 'week' | 'month';

export interface AggregateExpression {
    readonly alias: string;
    readonly function: AggregateFunction;
    readonly sourceAlias?: string;
    readonly propertyName?: string;
}

export type GroupKeyExpression =
  | PropertyGroupKeyExpression
  | DateBucketGroupKeyExpression;

export interface PropertyGroupKeyExpression {
    readonly kind: 'property';
    readonly alias: string;
    readonly sourceAlias?: string;
    readonly propertyName: string;
}

export interface DateBucketGroupKeyExpression {
    readonly kind: 'dateBucket';
    readonly alias: string;
    readonly provider: 'postgres';
    readonly precision: DateBucketPrecision;
    readonly timeZone: string;
    readonly sourceAlias?: string;
    readonly propertyName: string;
}

export type GroupKeyProjectionExpression =
  | PropertyGroupKeyProjectionExpression
  | DateBucketGroupKeyProjectionExpression;

export interface PropertyGroupKeyProjectionExpression {
    readonly kind: 'property';
    readonly alias: string;
    readonly keyAlias: string;
    readonly sourceAlias?: string;
    readonly propertyName: string;
}

export interface DateBucketGroupKeyProjectionExpression {
    readonly kind: 'dateBucket';
    readonly alias: string;
    readonly keyAlias: string;
    readonly provider: 'postgres';
    readonly precision: DateBucketPrecision;
    readonly timeZone: string;
    readonly sourceAlias?: string;
    readonly propertyName: string;
}

export interface AggregateOrderExpression {
    readonly operand: HavingOperandExpression;
    readonly direction: SortDirection;
}

export type HavingOperandExpression =
  | HavingAggregateOperandExpression
  | HavingGroupKeyOperandExpression;

export interface HavingAggregateOperandExpression {
    readonly kind: 'aggregate';
    readonly function: AggregateFunction;
    readonly sourceAlias?: string;
    readonly propertyName?: string;
}

export interface HavingGroupKeyOperandExpression {
    readonly kind: 'groupKey';
    readonly keyAlias: string;
    readonly expressionKind: GroupKeyExpression['kind'];
    readonly provider?: 'postgres';
    readonly precision?: DateBucketPrecision;
    readonly timeZone?: string;
    readonly sourceAlias?: string;
    readonly propertyName: string;
}

export type HavingPredicateNode =
  | HavingBinaryPredicateNode
  | HavingNullPredicateNode
  | HavingLogicalPredicateNode
  | HavingNotPredicateNode;

export interface HavingBinaryPredicateNode {
    readonly kind: 'binary';
    readonly operand: HavingOperandExpression;
    readonly operator: BinaryOperator;
    readonly value: unknown;
}

export interface HavingNullPredicateNode {
    readonly kind: 'null';
    readonly operand: HavingOperandExpression;
    readonly operator: NullOperator;
}

export interface HavingLogicalPredicateNode {
    readonly kind: 'logical';
    readonly operator: LogicalOperator;
    readonly left: HavingPredicateNode;
    readonly right: HavingPredicateNode;
}

export interface HavingNotPredicateNode {
    readonly kind: 'not';
    readonly predicate: HavingPredicateNode;
}
