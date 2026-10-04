import { sqliteDdlMatches, sqliteDdlText } from './sqlite-ddl-text';

export function parenthesizedBody(sql: string | undefined): string | undefined {
    if (!sql) {
        return undefined;
    }
    const text = sqliteDdlText(sql);
    const open = text.code.indexOf('(');
    const close = matchingParen(text.code, open);
    return open >= 0 && close > open ? text.sql.slice(open + 1, close) : undefined;
}

export function tableDefinitionSuffix(sql: string | undefined): string {
    if (!sql) {
        return '';
    }
    const text = sqliteDdlText(sql);
    const close = matchingParen(text.code, text.code.indexOf('('));
    return close < 0 ? '' : text.sql.slice(close + 1);
}

export function hasKeywordSequence(
    sql: string,
    expected: readonly string[],
): boolean {
    const tokens = (sqliteDdlText(sql).code.match(/[A-Za-z_][A-Za-z0-9_$]*/g) ?? [])
        .map(token => token.toLowerCase());
    const target = expected.map(word => word.toLowerCase());
    return tokens.some((_token, index) =>
        target.every((word, offset) => tokens[index + offset] === word));
}

export function matchingParen(sql: string, open: number): number {
    const code = sqliteDdlText(sql).code;
    if (open < 0 || code[open] !== '(') {
        return -1;
    }
    let depth = 0;
    for (let index = open; index < code.length; index++) {
        const char = code[index];
        if (char === '(') {
            depth++;
        } else if (char === ')' && --depth === 0) {
            return index;
        }
    }
    return -1;
}

export function splitTopLevel(sql: string): string[] {
    const text = sqliteDdlText(sql);
    const parts: string[] = [];
    let start = 0;
    let depth = 0;
    for (let index = 0; index < text.code.length; index++) {
        const char = text.code[index];
        if (char === '(') {
            depth++;
        } else if (char === ')') {
            depth--;
        } else if (char === ',' && depth === 0) {
            parts.push(text.sql.slice(start, index).trim());
            start = index + 1;
        }
    }
    parts.push(text.sql.slice(start).trim());
    return parts.filter(Boolean);
}

export function readIdentifier(sql: string): string | undefined {
    return /^(?:"(?:[^"]|"")+"|`(?:[^`]|``)+`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_$]*)/.exec(sql)?.[0];
}

export function simpleIdentifier(sql: string): string | undefined {
    const value = sql.trim();
    const identifier = readIdentifier(value);
    return identifier?.length === value.length
        ? unquoteIdentifier(identifier)
        : undefined;
}

export function unquoteIdentifier(value: string): string {
    const first = value[0];
    const last = value.at(-1);
    if (first === '"' && last === '"' || first === '`' && last === '`') {
        return value.slice(1, -1).replace(new RegExp(`${first}${first}`, 'g'), first);
    }
    return first === '[' && last === ']' ? value.slice(1, -1) : value;
}

export function collectNamedCheckNames(
    definitions: readonly string[],
): Set<string> {
    const names: Set<string> = new Set();
    const marker = /\bconstraint\s+("(?:[^"]|"")+"|`(?:[^`]|``)+`|\[[^\]]+\]|[^\s(]+)\s+check\s*\(/ig;
    for (const definition of definitions) {
        for (const match of sqliteDdlMatches(definition, marker)) {
            names.add(unquoteIdentifier(match[1]));
        }
    }
    return names;
}
