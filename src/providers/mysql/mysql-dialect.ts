import type { AlterColumnChange, SqlDialect } from '../../sql/sql-dialect';
import type { StoreGenerationStrategy } from '../../model/store-generation';
import { mapMysqlColumnType } from './mysql-column-type';
import {
    quoteMysqlIdentifier,
    quoteMysqlQualifiedIdentifier,
} from './mysql-identifiers';
import { mysqlStoreGenerationClause } from './mysql-store-generation';
import { mysqlProjectionExpressions } from './mysql-projection-expressions';

/** MySQL runtime SQL dialect. */
export const mySqlDialect: SqlDialect = Object.freeze({
    name: 'mysql',
    upsertConflictTarget: 'anyUnique',
    maxStatementParameters(): number {
        return 65535;
    },
    supportsWindowFunctions(): boolean {
    // MySQL has had window functions since 8.0 (2018); 5.7 and earlier cannot
    // run them, but the mysql2 driver this provider targets speaks to 8.0+.
        return true;
    },
    avgOperand(columnSql: string): string {
    // AVG of an integer column returns a truncated DECIMAL, and in a `group by`
    // query casting the result to double does not recover the digits — the
    // truncation happens first. Average the column cast to double so the result
    // keeps full precision, matching Postgres (numeric) and SQLite (double).
        return `cast(${columnSql} as double)`;
    },
    ...mysqlProjectionExpressions,
    unlimitedLimitLiteral(): string {
    // MySQL rejects a bare `offset`; its idiom for "no limit" is the largest
    // unsigned BIGINT as the limit (`limit 18446744073709551615 offset n`).
        return '18446744073709551615';
    },
    nullOrderingPrefix(columnExpr: string, direction: 'asc' | 'desc'): string {
    // MySQL has no `nulls last`. It sorts nulls as smaller than any value, so a
    // leading `(col is null)` term puts them SQL-standard: last ascending
    // (0 before 1), first descending (1 before 0).
        return `${columnExpr} is null ${direction}, `;
    },
    createIndexExistenceGuard(): string {
    // MySQL has no `create index if not exists`, so index creation cannot be
    // made idempotent and the guard is dropped rather than emitting DDL the
    // server rejects.
        return '';
    },
    generatedColumnClause(expression: string, stored: boolean): string {
        return `generated always as (${expression}) ${stored ? 'stored' : 'virtual'}`;
    },
    storeGenerationClause(
        strategy: StoreGenerationStrategy,
        column: { readonly type: string; readonly isPrimaryKey: boolean },
    ): string {
        return mysqlStoreGenerationClause(strategy, column);
    },
    indexExpression(expression: string): string {
        return `(${expression})`;
    },
    dropConstraintClause(kind: 'primaryKey' | 'unique' | 'foreignKey' | 'check', quotedName: string): string {
    // MySQL has no generic `drop constraint`: each kind has its own clause, and
    // the primary key is unnamed.
        switch (kind) {
            case 'primaryKey':
                return 'drop primary key';
            case 'unique':
                return `drop index ${quotedName}`;
            case 'foreignKey':
                return `drop foreign key ${quotedName}`;
            case 'check':
                return `drop check ${quotedName}`;
        }
    },
    dropIndexStatement(quotedIndex: string, quotedTable: string | undefined): string {
        if (!quotedTable) {
            throw new Error('The MySQL provider needs the index\'s table to drop it; pass { tableName } to dropIndex(...).');
        }
        // MySQL drops an index only in the scope of its table, and has no `if exists`.
        return `drop index ${quotedIndex} on ${quotedTable}`;
    },
    alterColumnStatements(quotedTable: string, quotedColumn: string, change: AlterColumnChange): readonly string[] {
        if (
            !change.typeChanged &&
            !change.nullabilityChanged &&
            !change.computedChanged &&
            !change.collationChanged &&
            !change.storeGenerationChanged
        ) {
            return [];
        }
        // MySQL redefines the whole column with `modify column`, which drops any
        // nullability and default it does not restate — so all three are emitted
        // together from the resolved values.
        const columnType = mapMysqlColumnType(change.resolvedType, {
            isKey: false,
            collation: change.resolvedCollation,
        });
        const nullability = change.resolvedNotNull ? 'not null' : 'null';
        const collation = change.resolvedCollation
            ? ` collate ${quoteMysqlIdentifier(change.resolvedCollation)}`
            : '';
        const generated = change.resolvedComputedSql
            ? ` generated always as (${change.resolvedComputedSql}) ${change.resolvedComputedStored === false ? 'virtual' : 'stored'}`
            : '';
        const defaultClause =
            !generated && change.resolvedDefaultSql !== undefined
                ? ` default ${change.resolvedDefaultSql}`
                : '';
        const storeGeneration = change.resolvedStoreGeneration
            ? ` ${mysqlStoreGenerationClause(
                change.resolvedStoreGeneration,
                { type: change.resolvedType, isPrimaryKey: true },
            )}`
            : '';
        return [`alter table ${quotedTable} modify column ${quotedColumn} ${columnType}${collation} ${nullability}${generated}${defaultClause}${storeGeneration}`];
    },
    quoteIdentifier: quoteMysqlIdentifier,
    quoteQualifiedIdentifier: quoteMysqlQualifiedIdentifier,
    mapColumnType: mapMysqlColumnType,
    parameter(): string {
        return '?';
    },
    countAllExpression(): string {
        return 'count(*)';
    },
    falsePredicate(): string {
        return '1 = 0';
    },
    upsertClause(_conflictColumns: readonly string[], updateColumns: readonly string[]): string {
    // MySQL keys the upsert on any unique index, not a named conflict target,
    // so the conflict columns are not part of the clause. `values(col)` reads
    // the row that would have been inserted.
        const assignments = updateColumns
            .map(column => `${quoteMysqlIdentifier(column)} = values(${quoteMysqlIdentifier(column)})`)
            .join(', ');
        return `on duplicate key update ${assignments}`;
    },
    insertConflictDoNothingClause(columns: readonly string[]): string {
    // No `do nothing`; the idiom is a no-op self-assignment, expressed against
    // a real column — a join table (the sole caller) has no `id`, so use the
    // first inserted column.
        const first = columns[0];
        const column = first ? quoteMysqlIdentifier(first) : '1';
        return `on duplicate key update ${column} = ${column}`;
    },
    defaultValuesInsertClause(): string {
        return '() values ()';
    },
});
