import type { SqlDialect } from '../../sql/sql-dialect';

export const mysqlProjectionExpressions: Pick<
    SqlDialect,
    'stringConcatExpression' | 'stringLengthExpression'
> = {
    stringConcatExpression(operands: readonly string[]): string {
        return `concat(${operands.join(', ')})`;
    },
    stringLengthExpression(operand: string): string {
        return `char_length(${operand})`;
    },
};
