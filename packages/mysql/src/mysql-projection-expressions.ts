import type { SqlDialect } from '@entitykit/core/adapter';

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
