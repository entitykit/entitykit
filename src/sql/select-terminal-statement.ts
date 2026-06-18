import type { SqlDialect } from './sql-dialect';
import type { SqlStatement } from './sql-statement';

export function buildCountStatement(
    dialect: SqlDialect,
    fromParts: readonly string[],
    where: string | undefined,
    values: readonly unknown[],
    paging: readonly string[] = [],
): SqlStatement {
    if (paging.length > 0) {
        const sequence = buildSequence(fromParts, where, paging);
        return {
            text: [
                `select ${dialect.countAllExpression()} as ${dialect.quoteIdentifier('count')}`,
                `from (${sequence}) ${dialect.quoteIdentifier('entitykit_page')}`,
            ].join(' '),
            values,
        };
    }

    const parts = [
        `select ${dialect.countAllExpression()} as ${dialect.quoteIdentifier('count')}`,
        ...fromParts,
    ];
    if (where) {
        parts.push(`where ${where}`);
    }
    return {
        text: parts.join(' '),
        values,
    };
}

export function buildExistsStatement(
    dialect: SqlDialect,
    fromParts: readonly string[],
    where: string | undefined,
    values: readonly unknown[],
    paging: readonly string[] = [],
): SqlStatement {
    if (paging.length > 0) {
        const sequence = buildSequence(fromParts, where, paging);
        return {
            text: [
                'select exists(select 1 from',
                `(${sequence}) ${dialect.quoteIdentifier('entitykit_page')}`,
                `limit 1) as ${dialect.quoteIdentifier('exists')}`,
            ].join(' '),
            values,
        };
    }

    const inner = [
        'select 1',
        ...fromParts,
    ];
    if (where) {
        inner.push(`where ${where}`);
    }
    inner.push('limit 1');

    return {
        text: `select exists(${inner.join(' ')}) as ${dialect.quoteIdentifier('exists')}`,
        values,
    };
}

function buildSequence(
    fromParts: readonly string[],
    where: string | undefined,
    paging: readonly string[],
): string {
    const parts = ['select 1', ...fromParts];
    if (where) {
        parts.push(`where ${where}`);
    }
    parts.push(...paging);
    return parts.join(' ');
}
