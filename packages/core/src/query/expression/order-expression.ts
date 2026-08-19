import type { EntityPropertyKey } from '../../types';

/** Direction applied by a query ordering expression. */
export type SortDirection = 'asc' | 'desc';

/** Expression contract for order. */ export interface OrderExpression<TEntity extends object = object> {
    /** The property name. */ readonly propertyName: EntityPropertyKey<TEntity>;
    /** The source alias. */ readonly sourceAlias?: string;
    /** The direction. */ readonly direction: SortDirection;
}
