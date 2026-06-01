export function parenthesizedBody(sql: string | undefined): string | undefined {
    if (!sql) {
        return undefined;
    }
    const open = sql.indexOf('(');
    const close = matchingParen(sql, open);
    return open >= 0 && close > open ? sql.slice(open + 1, close) : undefined;
}

export function tableDefinitionSuffix(sql: string | undefined): string {
    if (!sql) {
        return '';
    }
    const close = matchingParen(sql, sql.indexOf('('));
    return close < 0 ? '' : sql.slice(close + 1);
}

export function hasKeywordSequence(
    sql: string,
    expected: readonly string[],
): boolean {
    const tokens: string[] = [];
    let quote = '';
    for (let index = 0; index < sql.length; index++) {
        const character = sql[index];
        if (quote) {
            if (character === quote && sql[index + 1] === quote && quote !== ']') {
                index++;
            } else if (character === quote) {
                quote = '';
            }
        } else if ('\'"`['.includes(character)) {
            quote = character === '[' ? ']' : character;
        } else if (/[A-Za-z_]/.test(character)) {
            const match = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(sql.slice(index));
            if (match) {
                tokens.push(match[0].toLowerCase());
                index += match[0].length - 1;
            }
        }
    }
    const target = expected.map(word => word.toLowerCase());
    return tokens.some((_token, index) =>
        target.every((word, offset) => tokens[index + offset] === word));
}

export function matchingParen(sql: string, open: number): number {
    let depth = 0;
    let quote = '';
    for (let index = open; index < sql.length; index++) {
        const char = sql[index];
        if (quote) {
            if (char === quote && sql[index + 1] === quote && quote !== ']') {
                index++;
            } else if (char === quote) {
                quote = '';
            }
            continue;
        }
        if ('\'"`['.includes(char)) {
            quote = char === '[' ? ']' : char;
        } else if (char === '(') {
            depth++;
        } else if (char === ')' && --depth === 0) {
            return index;
        }
    }
    return -1;
}

export function splitTopLevel(sql: string): string[] {
    const parts: string[] = [];
    let start = 0;
    let depth = 0;
    let quote = '';
    for (let index = 0; index < sql.length; index++) {
        const char = sql[index];
        if (quote) {
            if (char === quote && sql[index + 1] === quote && quote !== ']') {
                index++;
            } else if (char === quote) {
                quote = '';
            }
            continue;
        }
        if ('\'"`['.includes(char)) {
            quote = char === '[' ? ']' : char;
        } else if (char === '(') {
            depth++;
        } else if (char === ')') {
            depth--;
        } else if (char === ',' && depth === 0) {
            parts.push(sql.slice(start, index).trim());
            start = index + 1;
        }
    }
    parts.push(sql.slice(start).trim());
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
    const marker = /\bconstraint\s+("[^"]+"|`[^`]+`|\[[^\]]+\]|[^\s(]+)\s+check\s*\(/ig;
    for (const definition of definitions) {
        let match: RegExpExecArray | null;
        while ((match = marker.exec(definition)) !== null) {
            names.add(unquoteIdentifier(match[1]));
        }
    }
    return names;
}
