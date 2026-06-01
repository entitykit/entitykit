import type { EntityPropertyKey } from '../types';
import type {
    ProjectionLiteralValue,
    ProjectionMaterialization,
    ProjectionSqlNode,
} from './projection-expression-types';

export type {
    ProjectionComputedExpression,
    ProjectionExpression,
    ProjectionFieldExpression,
    ProjectionLiteralExpression,
    ProjectionLiteralValue,
    ProjectionMaterialization,
    ProjectionSqlNode,
} from './projection-expression-types';

export const projectionFieldSymbol: unique symbol =
    Symbol('entitykit.projectionField');
export const projectionLiteralSymbol: unique symbol =
    Symbol('entitykit.projectionLiteral');
export const sqlExpressionSymbol: unique symbol =
    Symbol('entitykit.sqlExpression');
/** Public contract for projection field. */ export interface ProjectionField<TProperty = unknown> {
    /** The sql expression symbol. */ readonly [projectionFieldSymbol]: true;
    /** The property name. */ readonly propertyName: string;
    /** The source alias. */ readonly sourceAlias?: string;
    /** The type. */ readonly __type?: TProperty;
}
/** Public contract for projection literal. */ export interface ProjectionLiteral<
    TValue extends ProjectionLiteralValue = ProjectionLiteralValue,
> {
    /** The sql expression symbol. */ readonly [projectionLiteralSymbol]: true;
    /** The value. */ readonly value: TValue;
    /** The type. */ readonly __type?: TValue;
}
/** Expression contract for sql. */ export interface SqlExpression<TResult = unknown> {
    /** The sql expression symbol. */ readonly [sqlExpressionSymbol]: true;
    /** The type. */ readonly __type?: TResult;
}
export interface RuntimeSqlExpression<TResult = unknown>
    extends SqlExpression<TResult> {
    readonly expression: ProjectionSqlNode;
    readonly materialization: ProjectionMaterialization;
}
/** Public type representing projection sql operand. */ export type ProjectionSqlOperand<TValue = unknown> =
    | ProjectionField<TValue>
    | SqlExpression<TValue>
    | (TValue extends ProjectionLiteralValue
        ? ProjectionLiteral<TValue>
        : never);

/** Fluent contract for configuring projection. */ export interface ProjectionBuilder {
    /** Perform the literal operation. */ literal<TValue extends ProjectionLiteralValue>(
        value: TValue,
    ): ProjectionLiteral<TValue>;
    /** Perform the lower operation. */ lower<TValue extends string | null | undefined>(
        value: ProjectionSqlOperand<TValue>,
    ): SqlExpression<
        [Extract<TValue, null | undefined>] extends [never]
            ? string : string | null
    >;
    /** Perform the upper operation. */ upper<TValue extends string | null | undefined>(
        value: ProjectionSqlOperand<TValue>,
    ): SqlExpression<
        [Extract<TValue, null | undefined>] extends [never]
            ? string : string | null
    >;
    /** Perform the trim operation. */ trim<TValue extends string | null | undefined>(
        value: ProjectionSqlOperand<TValue>,
    ): SqlExpression<
        [Extract<TValue, null | undefined>] extends [never]
            ? string : string | null
    >;
    /** Perform the length operation. */ length<TValue extends string | null | undefined>(
        value: ProjectionSqlOperand<TValue>,
    ): SqlExpression<
        [Extract<TValue, null | undefined>] extends [never]
            ? number : number | null
    >;
    /** Perform the concat operation. */ concat<TValue extends string | null | undefined>(
        first: ProjectionSqlOperand<TValue>,
        second: ProjectionSqlOperand<TValue>,
        ...rest: ReadonlyArray<ProjectionSqlOperand<TValue>>
    ): SqlExpression<
        [Extract<TValue, null | undefined>] extends [never]
            ? string : string | null
    >;
    /** Perform the coalesce operation. */ coalesce<TValue>(
        value: ProjectionSqlOperand<TValue | null | undefined>,
        fallback: ProjectionSqlOperand<NoInfer<NonNullable<TValue>>>,
    ): SqlExpression<NonNullable<TValue>>;
    /** Perform the add operation. */ add<TValue extends number | null | undefined>(
        left: ProjectionSqlOperand<TValue>,
        right: ProjectionSqlOperand<TValue>,
    ): SqlExpression<
        [Extract<TValue, null | undefined>] extends [never]
            ? number : number | null
    >;
    /** Perform the subtract operation. */ subtract<TValue extends number | null | undefined>(
        left: ProjectionSqlOperand<TValue>,
        right: ProjectionSqlOperand<TValue>,
    ): SqlExpression<
        [Extract<TValue, null | undefined>] extends [never]
            ? number : number | null
    >;
    /** Perform the multiply operation. */ multiply<TValue extends number | null | undefined>(
        left: ProjectionSqlOperand<TValue>,
        right: ProjectionSqlOperand<TValue>,
    ): SqlExpression<
        [Extract<TValue, null | undefined>] extends [never]
            ? number : number | null
    >;
    /** Perform the modulo operation. */ modulo<TValue extends number | null | undefined>(
        left: ProjectionSqlOperand<TValue>,
        right: ProjectionSqlOperand<TValue>,
    ): SqlExpression<
        [Extract<TValue, null | undefined>] extends [never]
            ? number : number | null
    >;
}

/** Public type representing projection proxy. */ export type ProjectionProxy<TEntity extends object> = {
    readonly [K in EntityPropertyKey<TEntity>]:
    ProjectionField<TEntity[K]> &
    (NonNullable<TEntity[K]> extends object
        ? ProjectionProxy<NonNullable<TEntity[K]>>
        : unknown);
};

/** Public contract for projection selection. */ export interface ProjectionSelection {
    /** One named field or nested object in a typed projection. */
    readonly [key: string]:
        | ProjectionField
        | ProjectionLiteral
        | SqlExpression
        | ProjectionSelection;
}

/** Result produced by projection. */ export type ProjectionResult<TSelection extends ProjectionSelection> = {
    readonly [K in keyof TSelection]:
    TSelection[K] extends ProjectionField<infer TResult> ? TResult :
        TSelection[K] extends ProjectionLiteral<infer TResult> ? TResult :
            TSelection[K] extends SqlExpression<infer TResult> ? TResult :
                TSelection[K] extends ProjectionSelection
                    ? ProjectionResult<TSelection[K]>
                    : never;
};
