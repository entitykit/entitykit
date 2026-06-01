/** Public type representing projection literal value. */ export type ProjectionLiteralValue = string | number | boolean | null;

export type ProjectionSqlNode =
    | ProjectionSqlFieldNode
    | ProjectionSqlLiteralNode
    | ProjectionSqlCallNode
    | ProjectionSqlBinaryNode;

export interface ProjectionSqlFieldNode {
    readonly kind: 'field';
    readonly sourceAlias?: string;
    readonly propertyName: string;
}

export interface ProjectionSqlLiteralNode {
    readonly kind: 'literal';
    readonly value: ProjectionLiteralValue;
}

export interface ProjectionSqlCallNode {
    readonly kind: 'call';
    readonly function:
        | 'lower' | 'upper' | 'trim' | 'length' | 'concat' | 'coalesce';
    readonly operands: readonly ProjectionSqlNode[];
}

export interface ProjectionSqlBinaryNode {
    readonly kind: 'binary';
    readonly operator: '+' | '-' | '*' | '%';
    readonly left: ProjectionSqlNode;
    readonly right: ProjectionSqlNode;
}

export interface ProjectionMaterialization {
    readonly kind: 'raw' | 'number' | 'field';
    readonly sourceAlias?: string;
    readonly propertyName?: string;
}

interface ProjectionOutput {
    readonly alias: string;
    /** Original result-object path. Absent for legacy flat projections. */
    readonly path?: readonly string[];
}

export interface ProjectionFieldExpression extends ProjectionOutput {
    readonly kind: 'field';
    readonly sourceAlias?: string;
    readonly propertyName: string;
}

export interface ProjectionLiteralExpression extends ProjectionOutput {
    readonly kind: 'literal';
    readonly value: ProjectionLiteralValue;
}

export interface ProjectionComputedExpression extends ProjectionOutput {
    readonly kind: 'computed';
    readonly expression: ProjectionSqlNode;
    readonly materialization: ProjectionMaterialization;
}

export type ProjectionExpression =
    | ProjectionFieldExpression
    | ProjectionLiteralExpression
    | ProjectionComputedExpression;
