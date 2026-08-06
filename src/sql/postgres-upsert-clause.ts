import type { UpsertMatchTarget } from './sql-dialect';
import { excludedColumnMatchClause } from './upsert-clause-match';
import {
    quoteIdentifier,
    quoteQualifiedIdentifier,
} from './postgres-identifiers';

/** Render Postgres conflict update SQL, including an authorized target match. */
export function postgresUpsertClause(
    conflictColumns: readonly string[],
    updateColumns: readonly string[],
    matchColumns: readonly string[] = [],
    matchTarget?: UpsertMatchTarget,
): string {
    const assignments = updateColumns
        .map(column =>
            `${quoteIdentifier(column)} = excluded.${quoteIdentifier(column)}`,
        )
        .join(', ');
    const qualifier = matchTarget
        ? quoteQualifiedIdentifier(
            matchTarget.schemaName,
            matchTarget.tableName,
        )
        : undefined;
    return `on conflict (${conflictColumns
        .map(quoteIdentifier)
        .join(', ')}) do update set ${assignments}${excludedColumnMatchClause(
        matchColumns,
        quoteIdentifier,
        qualifier,
    )}`;
}
