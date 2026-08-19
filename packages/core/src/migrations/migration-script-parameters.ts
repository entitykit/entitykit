import type { SqlDialect } from '../sql/sql-dialect';
import {
    scanSqlPlaceholders,
    type SqlPlaceholderSpan,
    type SqlPlaceholderStyle,
} from '../sql/sql-placeholder-scanner';
import type { SqlStatement } from '../sql/sql-statement';
import { renderMigrationScriptLiteral } from './migration-script-literal';

export function inlineScriptParameters(
    statement: SqlStatement,
    dialect: SqlDialect,
): string {
    const style = placeholderStyle(dialect);
    const placeholders = scanSqlPlaceholders(statement.text, style, {
        backslashEscapes: dialect.name === 'mysql',
        dollarQuotes: style === 'numbered',
        hashLineComments: dialect.name === 'mysql',
        postgresEscapeStrings: style === 'numbered',
    });
    validateCardinality(placeholders, statement.values.length, style);

    let rendered = '';
    let cursor = 0;
    for (const placeholder of placeholders) {
        rendered += statement.text.slice(cursor, placeholder.start);
        rendered += renderMigrationScriptLiteral(
            statement.values[placeholder.valueIndex],
            dialect,
        );
        cursor = placeholder.end;
    }
    return rendered + statement.text.slice(cursor);
}

function placeholderStyle(dialect: SqlDialect): SqlPlaceholderStyle {
    const first = dialect.parameter(1);
    const second = dialect.parameter(2);
    if (first === '?' && second === '?') {
        return 'question';
    }
    if (first === '$1' && second === '$2') {
        return 'numbered';
    }
    throw new Error(
        `Migration scripts do not support '${dialect.name}' placeholders '${first}' and '${second}'.`,
    );
}

function validateCardinality(
    placeholders: readonly SqlPlaceholderSpan[],
    valueCount: number,
    style: SqlPlaceholderStyle,
): void {
    if (style === 'question') {
        if (placeholders.length !== valueCount) {
            throw parameterCountError(placeholders.length, valueCount);
        }
        return;
    }

    const indexes = new Set(placeholders.map(placeholder => placeholder.valueIndex));
    const invalid = placeholders.find(placeholder =>
        placeholder.valueIndex < 0 ||
    !Number.isSafeInteger(placeholder.valueIndex),
    );
    if (invalid) {
        throw new Error(
            `Migration script contains invalid numbered placeholder '${invalid.text}'.`,
        );
    }
    const complete = indexes.size === valueCount &&
    [...indexes].every(index => index < valueCount);
    if (!complete) {
        const found = [...indexes]
            .sort((left, right) => left - right)
            .map(index => `$${String(index + 1)}`)
            .join(', ') || 'none';
        const expected = valueCount === 0
            ? 'no numbered placeholders'
            : `$1 through $${String(valueCount)}`;
        throw new Error(
            `Migration script parameter mismatch: expected ${expected}, but found ${found}.`,
        );
    }
}

function parameterCountError(placeholders: number, values: number): Error {
    return new Error(
        `Migration script parameter mismatch: found ${String(placeholders)} '?' placeholders for ${String(values)} values.`,
    );
}
