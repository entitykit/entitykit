export function skipSqlQuoted(
    sql: string,
    start: number,
    quote: string,
    backslashEscapes: boolean,
): number {
    let index = start + 1;
    while (index < sql.length) {
        if (backslashEscapes && sql[index] === '\\') {
            index += 2;
            continue;
        }
        if (sql[index] !== quote) {
            index += 1;
            continue;
        }
        if (sql[index + 1] === quote) {
            index += 2;
            continue;
        }
        return index + 1;
    }
    return sql.length;
}

export function skipSqlLineComment(sql: string, start: number): number {
    const newline = sql.indexOf('\n', start + 1);
    return newline < 0 ? sql.length : newline + 1;
}

export function skipSqlBlockComment(sql: string, start: number): number {
    let depth = 1;
    let index = start + 2;
    while (index < sql.length && depth > 0) {
        if (sql.startsWith('/*', index)) {
            depth += 1;
            index += 2;
        } else if (sql.startsWith('*/', index)) {
            depth -= 1;
            index += 2;
        } else {
            index += 1;
        }
    }
    return index;
}

export function sqlDollarQuoteDelimiter(
    sql: string,
    start: number,
): string | undefined {
    if (sql[start + 1] === '$') {
        return '$$';
    }
    if (!/[\p{L}_]/u.test(sql[start + 1] ?? '')) {
        return undefined;
    }
    let index = start + 2;
    while (/[\p{L}\p{M}\p{N}_]/u.test(sql[index] ?? '')) {
        index += 1;
    }
    return sql[index] === '$' ? sql.slice(start, index + 1) : undefined;
}

export function skipSqlDollarQuote(
    sql: string,
    start: number,
    delimiter: string,
): number {
    const end = sql.indexOf(delimiter, start + delimiter.length);
    return end < 0 ? sql.length : end + delimiter.length;
}

export function isSqlIdentifierCharacter(
    character: string | undefined,
): boolean {
    return /[\p{L}\p{M}\p{N}_$]/u.test(character ?? '');
}
