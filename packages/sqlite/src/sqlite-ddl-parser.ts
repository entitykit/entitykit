import type {
    DatabaseCheckConstraint,
    DatabaseIndexKeyPart,
} from '@entitykit/core/adapter';
import { sqliteColumnChecks, sqliteGeneratedExpression, sqliteParenthesizedDefault } from './sqlite-ddl-column';
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
import { sqliteDdlMatches, sqliteDdlText } from './sqlite-ddl-text';
export interface SqliteColumnDdl {
    readonly autoIncrement: boolean;
    readonly defaultSql?: string;
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
        const namedCheck = /^constraint\s+("(?:[^"]|"")+"|`(?:[^`]|``)+`|\[[^\]]+\]|\S+)\s+check\s*\(([\s\S]*)\)$/i.exec(definition);
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
        const collation = sqliteDdlMatches(rest, /\bcollate\s+("(?:[^"]|"")+"|`(?:[^`]|``)+`|\[[^\]]+\]|[^\s,)]+)/ig).at(0)?.[1];
        const generated = sqliteGeneratedExpression(rest);
        columns.set(unquoteIdentifier(identifier), {
            autoIncrement: hasKeywordSequence(rest, ['autoincrement']),
            defaultSql: sqliteParenthesizedDefault(rest),
            collation: collation ? unquoteIdentifier(collation) : undefined,
            generatedExpression: generated?.expression,
            generatedStored: generated?.stored,
            primaryKeyDescending: hasKeywordSequence(rest, ['primary', 'key', 'desc']),
        });
        checks.push(...sqliteColumnChecks(
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
    const text = sqliteDdlText(sql);
    const onPosition = text.code.search(/\bon\b/i);
    const open = text.code.indexOf('(', onPosition);
    const close = matchingParen(text.code, open);
    if (onPosition < 0 || open < 0 || close < 0) {
        return {};
    }
    const keyParts = splitTopLevel(text.sql.slice(open + 1, close)).map(term => {
        const identifier = simpleIdentifier(term);
        return identifier
            ? { kind: 'column' as const, name: identifier }
            : { kind: 'expression' as const, expression: term.trim() };
    });
    const tail = text.sql.slice(close + 1).trim();
    const filter = /^where\s+([\s\S]+)$/i.exec(tail)?.[1]?.trim();
    return { keyParts, filter };
}
