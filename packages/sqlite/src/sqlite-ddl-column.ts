import type { DatabaseCheckConstraint } from '@entitykit/core/adapter';
import { matchingParen, unquoteIdentifier } from './sqlite-ddl-scanner';
import { sqliteDdlMatches } from './sqlite-ddl-text';

export function sqliteParenthesizedDefault(sql: string): string | undefined {
    const match = sqliteDdlMatches(sql, /\bdefault\s*\(/ig).at(0);
    if (!match) return undefined;
    const open = match.index + match[0].lastIndexOf('(');
    const close = matchingParen(sql, open);
    return close < 0 ? undefined : sql.slice(open, close + 1);
}

export function sqliteGeneratedExpression(sql: string): { expression: string; stored: boolean } | undefined {
    const marker = /\b(?:generated\s+always\s+)?as\s*\(/ig;
    const match = sqliteDdlMatches(sql, marker).at(0);
    if (!match) {
        return undefined;
    }
    const open = match.index + match[0].lastIndexOf('(');
    const close = matchingParen(sql, open);
    if (close < 0) {
        return undefined;
    }
    return {
        expression: sql.slice(open + 1, close).trim(),
        stored: /^\s*stored\b/i.test(sql.slice(close + 1)),
    };
}

export function sqliteColumnChecks(
    sql: string,
    anonymousName: () => string,
): DatabaseCheckConstraint[] {
    const checks: DatabaseCheckConstraint[] = [];
    const marker = /\b(?:constraint\s+("(?:[^"]|"")+"|`(?:[^`]|``)+`|\[[^\]]+\]|[^\s(]+)\s+)?check\s*\(/ig;
    let previousClose = -1;
    for (const match of sqliteDdlMatches(sql, marker)) {
        if (match.index <= previousClose) {
            continue;
        }
        const open = match.index + match[0].lastIndexOf('(');
        const close = matchingParen(sql, open);
        if (close < 0) {
            break;
        }
        checks.push({
            name: match[1] ? unquoteIdentifier(match[1]) : anonymousName(),
            sql: sql.slice(open + 1, close).trim(),
        });
        previousClose = close;
    }
    return checks;
}
