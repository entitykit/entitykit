import type { SortDirection } from './expression/order-expression';

/** Ordering produced by `asc()` or `desc()` on a grouped field. */
export interface AggregateOrderExpression {
    /** The direction. */ readonly direction: SortDirection;
}
