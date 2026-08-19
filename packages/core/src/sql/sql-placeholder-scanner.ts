import {
    isSqlIdentifierCharacter,
    skipSqlBlockComment,
    skipSqlDollarQuote,
    skipSqlLineComment,
    skipSqlQuoted,
    sqlDollarQuoteDelimiter,
} from './sql-placeholder-context';

export type SqlPlaceholderStyle = 'question' | 'numbered';

export interface SqlPlaceholderScanOptions {
    readonly backslashEscapes?: boolean;
    readonly dollarQuotes?: boolean;
    readonly hashLineComments?: boolean;
    readonly postgresEscapeStrings?: boolean;
}

export interface SqlPlaceholderSpan {
    readonly start: number;
    readonly end: number;
    readonly valueIndex: number;
    readonly text: string;
}

/** Find bind markers while leaving SQL literals, identifiers, and comments opaque. */
export function scanSqlPlaceholders(
    sql: string,
    style: SqlPlaceholderStyle,
    options: SqlPlaceholderScanOptions = {},
): readonly SqlPlaceholderSpan[] {
    const spans: SqlPlaceholderSpan[] = [];
    let questionIndex = 0;
    let index = 0;

    while (index < sql.length) {
        const character = sql[index];
        if (character === '\'' || character === '"' || character === '`') {
            index = skipSqlQuoted(
                sql,
                index,
                character,
                usesBackslashEscapes(sql, index, character, options),
            );
            continue;
        }
        if (sql.startsWith('--', index) || options.hashLineComments && character === '#') {
            index = skipSqlLineComment(sql, index);
            continue;
        }
        if (sql.startsWith('/*', index)) {
            index = skipSqlBlockComment(sql, index);
            continue;
        }
        if (character === '$') {
            const canStartToken = !isSqlIdentifierCharacter(sql[index - 1]);
            const delimiter = canStartToken && options.dollarQuotes
                ? sqlDollarQuoteDelimiter(sql, index)
                : undefined;
            if (delimiter) {
                index = skipSqlDollarQuote(sql, index, delimiter);
                continue;
            }
            if (style === 'numbered' && canStartToken) {
                const end = numberedPlaceholderEnd(sql, index);
                if (end > index + 1) {
                    const text = sql.slice(index, end);
                    spans.push({
                        start: index,
                        end,
                        valueIndex: Number(text.slice(1)) - 1,
                        text,
                    });
                    index = end;
                    continue;
                }
            }
        }
        if (style === 'question' && character === '?') {
            spans.push({
                start: index,
                end: index + 1,
                valueIndex: questionIndex,
                text: '?',
            });
            questionIndex += 1;
        }
        index += 1;
    }

    return spans;
}

function numberedPlaceholderEnd(sql: string, start: number): number {
    let index = start + 1;
    while (/[0-9]/.test(sql[index] ?? '')) {
        index += 1;
    }
    return index;
}

function usesBackslashEscapes(
    sql: string,
    start: number,
    quote: string,
    options: SqlPlaceholderScanOptions,
): boolean {
    if (options.backslashEscapes) {
        return true;
    }
    return Boolean(
        options.postgresEscapeStrings &&
    quote === '\'' &&
    sql.at(start - 1)?.toLowerCase() === 'e' &&
    !isSqlIdentifierCharacter(sql[start - 2]),
    );
}
