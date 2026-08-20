import type { Migration } from '@entitykit/core/migrations';
import type { StoreGenerationStrategy } from '@entitykit/core/adapter';
import { entityKitMigrationVersion, migrationHistoryTableName } from '@entitykit/core/migrations';
import type { MigrationSqlDialect } from '@entitykit/core/adapter';
import type { SqlDialect } from '@entitykit/core/adapter';
import type { SqlStatement } from '@entitykit/core/adapter';
import { sqliteStoreGenerationClause } from './sqlite-store-generation';
import { excludedColumnMatchClause } from '@entitykit/core/adapter';

function quoteIdentifier(identifier: string): string {
    if (!identifier || identifier.trim().length === 0) {
        throw new Error('SQL identifier cannot be empty.');
    }

    return `"${identifier.replace(/"/g, '""')}"`;
}

function quoteQualifiedIdentifier(...identifiers: ReadonlyArray<string | undefined>): string {
    const parts = identifiers.filter((identifier): identifier is string => identifier !== undefined && identifier.length > 0);
    if (parts.length === 0) {
        throw new Error('SQL identifier cannot be empty.');
    }

    return parts.map(part => quoteIdentifier(part)).join('.');
}

/**
 * Runtime SQL dialect for SQLite: anonymous `?` placeholders, standard
 * double-quoted identifiers, and `on conflict do nothing` (SQLite >= 3.24).
 */
export const sqliteDialect: SqlDialect = Object.freeze({
    name: 'sqlite',
    maxStatementParameters(): number {
    // SQLITE_MAX_VARIABLE_NUMBER, whose compiled-in default has been 32766
    // since 3.32. Builds may lower it; a build that does will reject a
    // statement this permits, which surfaces as an ordinary provider error.
        return 32766;
    },
    supportsWindowFunctions(): boolean {
    // SQLite has had window functions since 3.25 (2018); the versions Node's
    // built-in `node:sqlite` ships are well past that.
        return true;
    },
    unlimitedLimitLiteral(): string {
    // SQLite rejects a bare `offset`; -1 is its idiom for "no limit".
        return '-1';
    },
    nullOrderingClause(direction: 'asc' | 'desc'): string {
    // SQLite sorts nulls as smaller than non-nulls, the opposite of Postgres,
    // so it needs the ordering stated explicitly.
        return direction === 'asc' ? ' nulls last' : ' nulls first';
    },
    generatedColumnClause(expression: string, stored: boolean): string {
        return `generated always as (${expression}) ${stored ? 'stored' : 'virtual'}`;
    },
    storeGenerationClause(
        strategy: StoreGenerationStrategy,
        column: { readonly type: string; readonly isPrimaryKey: boolean },
    ): string {
        return sqliteStoreGenerationClause(strategy, column);
    },
    indexExpression(expression: string): string {
        return expression;
    },
    indexFilterClause(sql: string): string {
        return ` where ${sql}`;
    },
    quoteIdentifier,
    quoteQualifiedIdentifier,
    parameter(): string {
        return '?';
    },
    countAllExpression(): string {
        return 'count(*)';
    },
    falsePredicate(): string {
        return '1 = 0';
    },
    upsertClause(conflictColumns: readonly string[], updateColumns: readonly string[], matchColumns: readonly string[] = []): string {
    // SQLite has spelled this the Postgres way since 3.24.
        const assignments = updateColumns
            .map(column => `${quoteIdentifier(column)} = excluded.${quoteIdentifier(column)}`)
            .join(', ');
        return `on conflict (${conflictColumns.map(quoteIdentifier).join(', ')}) do update set ${assignments}${excludedColumnMatchClause(matchColumns, quoteIdentifier)}`;
    },
    insertConflictDoNothingClause(): string {
        return 'on conflict do nothing';
    },
    returningClause(columns: readonly string[]): string {
        return `returning ${columns.map(quoteIdentifier).join(', ')}`;
    },
});

/**
 * Migration SQL dialect for SQLite. Advisory locks and idempotent do-blocks are
 * intentionally omitted — SQLite has neither — so migration updates report
 * `usedMigrationLock: false` and idempotent-script generation fails clearly.
 */
export const sqliteMigrationDialect: MigrationSqlDialect = Object.freeze({
    name: 'sqlite',
    sql: sqliteDialect,
    createMigrationHistoryTableStatement(): SqlStatement {
        return {
            text: `create table if not exists ${quoteIdentifier(migrationHistoryTableName)} (${quoteIdentifier('id')} text primary key, ${quoteIdentifier('name')} text not null, ${quoteIdentifier('checksum')} text not null, ${quoteIdentifier('entitykit_version')} text not null)`,
            values: [],
        };
    },
    selectMigrationHistoryStatement(): SqlStatement {
        return {
            text: `select ${quoteIdentifier('id')}, ${quoteIdentifier('name')}, ${quoteIdentifier('checksum')}, ${quoteIdentifier('entitykit_version')} from ${quoteIdentifier(migrationHistoryTableName)} order by ${quoteIdentifier('id')}`,
            values: [],
        };
    },
    migrationHistoryTableExistsStatement(): SqlStatement {
        return {
            text: `select exists (select 1 from sqlite_master where type = 'table' and name = ?) as ${quoteIdentifier('exists')}`,
            values: [migrationHistoryTableName],
        };
    },
    insertMigrationHistoryStatement(
        migration: Migration,
        checksum: string,
    ): SqlStatement {
        return {
            text: `insert into ${quoteIdentifier(migrationHistoryTableName)} (${quoteIdentifier('id')}, ${quoteIdentifier('name')}, ${quoteIdentifier('checksum')}, ${quoteIdentifier('entitykit_version')}) values (${sqliteDialect.parameter(1)}, ${sqliteDialect.parameter(2)}, ${sqliteDialect.parameter(3)}, ${sqliteDialect.parameter(4)})`,
            values: [migration.id, migration.name, checksum, entityKitMigrationVersion],
        };
    },
    deleteMigrationHistoryStatement(migration: Migration): SqlStatement {
        return {
            text: `delete from ${quoteIdentifier(migrationHistoryTableName)} where ${quoteIdentifier('id')} = ${sqliteDialect.parameter(1)}`,
            values: [migration.id],
        };
    },
});
