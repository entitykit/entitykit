import type {
    DatabaseCheckConstraint,
    DatabaseIndexKeyPart,
} from '../../introspection/database-schema';
import {
    collectNamedCheckNames,
    hasKeywordSequence,
    matchingParen,
    parenthesizedBody,
    readIdentifier,
    simpleIdentifier,
    splitTopLevel,
    tableDefinitionSuffix,
    unquoteIdentifier,
} from './sqlite-ddl-scanner';
export interface SqliteColumnDdl {
    readonly autoIncrement: boolean;
    readonly collation?: string;
    readonly generatedExpression?: string;
    readonly generatedStored?: boolean;
    readonly primaryKeyDescending: boolean;
}
export function parseSqliteTableSql(sql: string | undefined): {
    columns: ReadonlyMap<string, SqliteColumnDdl>;
    checks: readonly DatabaseCheckConstraint[];
    withoutRowId: boolean;
} {
    const columns: Map<string, SqliteColumnDdl> = new Map();
    const checks: DatabaseCheckConstraint[] = [];
    const body = parenthesizedBody(sql);
    if (!body) {
        return { columns, checks, withoutRowId: false };
    }
    const definitions = splitTopLevel(body);
    const usedCheckNames = collectNamedCheckNames(definitions);
    let anonymousCheck = 0;
    const anonymousName = (): string => {
        let candidate: string;
        do {
            candidate = `ck_pulled_${String(++anonymousCheck)}`;
        } while (usedCheckNames.has(candidate));
        usedCheckNames.add(candidate);
        return candidate;
    };
    for (const definition of definitions) {
        const namedCheck = /^constraint\s+("[^"]+"|`[^`]+`|\[[^\]]+\]|\S+)\s+check\s*\(([\s\S]*)\)$/i.exec(definition);
        if (namedCheck) {
            checks.push({ name: unquoteIdentifier(namedCheck[1]), sql: namedCheck[2].trim() });
            continue;
        }
        const tableCheck = /^check\s*\(([\s\S]*)\)$/i.exec(definition);
        if (tableCheck) {
            checks.push({
                name: anonymousName(),
                sql: tableCheck[1].trim(),
            });
            continue;
        }
        if (/^(primary|unique|foreign|constraint)\b/i.test(definition)) {
            continue;
        }
        const identifier = readIdentifier(definition);
        if (!identifier) {
            continue;
        }
        const rest = definition.slice(identifier.length).trim();
        const collation = /\bcollate\s+("[^"]+"|`[^`]+`|\[[^\]]+\]|[^\s,)]+)/i.exec(rest)?.[1];
        const generated = generatedExpression(rest);
        columns.set(unquoteIdentifier(identifier), {
            autoIncrement: hasKeywordSequence(rest, ['autoincrement']),
            collation: collation ? unquoteIdentifier(collation) : undefined,
            generatedExpression: generated?.expression,
            generatedStored: generated?.stored,
            primaryKeyDescending: hasKeywordSequence(rest, ['primary', 'key', 'desc']),
        });
        checks.push(...columnChecks(
            rest,
            anonymousName,
        ));
    }
    return {
        columns,
        checks,
        withoutRowId: hasKeywordSequence(tableDefinitionSuffix(sql), ['without', 'rowid']),
    };
}

export function parseSqliteIndexSql(sql: string | undefined): {
    keyParts?: readonly DatabaseIndexKeyPart[];
    filter?: string;
} {
    if (!sql) {
        return {};
    }
    const onPosition = sql.search(/\bon\b/i);
    const open = sql.indexOf('(', onPosition);
    const close = matchingParen(sql, open);
    if (open < 0 || close < 0) {
        return {};
    }
    const keyParts = splitTopLevel(sql.slice(open + 1, close)).map(term => {
        const identifier = simpleIdentifier(term);
        return identifier
            ? { kind: 'column' as const, name: identifier }
            : { kind: 'expression' as const, expression: term.trim() };
    });
    const tail = sql.slice(close + 1).trim();
    const filter = /^where\s+([\s\S]+)$/i.exec(tail)?.[1]?.trim();
    return { keyParts, filter };
}

function generatedExpression(sql: string): { expression: string; stored: boolean } | undefined {
    const marker = /\b(?:generated\s+always\s+)?as\s*\(/ig;
    const match = marker.exec(sql);
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

function columnChecks(
    sql: string,
    anonymousName: () => string,
): DatabaseCheckConstraint[] {
    const checks: DatabaseCheckConstraint[] = [];
    const marker = /\b(?:constraint\s+("[^"]+"|`[^`]+`|\[[^\]]+\]|[^\s(]+)\s+)?check\s*\(/ig;
    let match: RegExpExecArray | null;
    while ((match = marker.exec(sql)) !== null) {
        const open = match.index + match[0].lastIndexOf('(');
        const close = matchingParen(sql, open);
        if (close < 0) {
            break;
        }
        checks.push({
            name: match[1] ? unquoteIdentifier(match[1]) : anonymousName(),
            sql: sql.slice(open + 1, close).trim(),
        });
        marker.lastIndex = close + 1;
    }
    return checks;
}
