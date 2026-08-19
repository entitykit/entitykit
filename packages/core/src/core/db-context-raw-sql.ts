import type { SqlStatement } from '../sql/sql-statement';
import type { DatabaseOperationOptions } from '../storage/database-connection';
import { RawSqlExecutor } from './raw-sql-executor';
import { DbContextMigrations } from './db-context-migrations';

/** Parameterized raw SQL operations exposed by a context. */
export abstract class DbContextRawSql extends DbContextMigrations {
    private readonly rawSqlExecutor = new RawSqlExecutor(
        () => this.databaseConnection,
        () => this.dialect,
    );

    public async sql<TRow extends Record<string, unknown> = Record<string, unknown>>(
        options: DatabaseOperationOptions,
        strings: TemplateStringsArray,
        ...values: readonly unknown[]
    ): Promise<TRow[]> {
        return this.rawSqlExecutor.sql<TRow>(options, strings, ...values);
    }

    public async execute(
        options: DatabaseOperationOptions,
        strings: TemplateStringsArray,
        ...values: readonly unknown[]
    ): Promise<number> {
        return this.rawSqlExecutor.execute(options, strings, ...values);
    }

    public async executeStatement(statement: SqlStatement, options?: DatabaseOperationOptions): Promise<number> {
        return this.rawSqlExecutor.executeStatement(statement, options);
    }

    public rawSql(
        strings: TemplateStringsArray,
        ...values: readonly unknown[]
    ): SqlStatement {
        return this.rawSqlExecutor.rawSql(strings, ...values);
    }
}
