import type { DatabaseConnection, DatabaseOperationOptions } from '../storage/database-connection';
import type { SqlDialect } from '../sql/sql-dialect';
import type { SqlStatement } from '../sql/sql-statement';
import { buildRawSql } from '../sql/raw-sql';

/**
 * The raw-SQL escape hatch of a `DbContext`: parameterized template execution
 * and prepared-statement execution. Held apart from the unit-of-work hub because
 * it borrows only the connection and dialect and touches no tracking, saving, or
 * transaction state. The connection and dialect resolve lazily, because a
 * context builds its collaborators before it has either.
 */
export class RawSqlExecutor {
    constructor(
        private readonly getDatabase: () => DatabaseConnection,
        private readonly getDialect: () => SqlDialect,
    ) {}

    private get database(): DatabaseConnection {
        return this.getDatabase();
    }

    private get dialect(): SqlDialect {
        return this.getDialect();
    }

    /** Execute parameterized raw SQL and return rows. */
    public async sql<TRow extends Record<string, unknown> = Record<string, unknown>>(
        options: DatabaseOperationOptions,
        strings: TemplateStringsArray,
        ...values: readonly unknown[]
    ): Promise<TRow[]> {
        return this.database.query<TRow>(
            buildRawSql(this.dialect, strings, ...values),
            options,
        ).then(result => result.rows);
    }

    /** Execute parameterized raw SQL and return the affected row count. */
    public async execute(options: DatabaseOperationOptions, strings: TemplateStringsArray, ...values: readonly unknown[]): Promise<number> {
        const result = await this.database.query(
            buildRawSql(this.dialect, strings, ...values),
            options,
        );
        return result.rowCount;
    }

    /** Execute a prepared SQL statement and return the affected row count. */
    public async executeStatement(statement: SqlStatement, options: DatabaseOperationOptions = {}): Promise<number> {
        const result = await this.database.query(statement, options);
        return result.rowCount;
    }

    /** Build a parameterized raw SQL statement without executing it. */
    public rawSql(strings: TemplateStringsArray, ...values: readonly unknown[]): SqlStatement {
        return buildRawSql(this.dialect, strings, ...values);
    }
}
