import type { SqlStatement } from '../sql/sql-statement';
import type { DatabaseConnection, DatabaseOperationOptions } from '../storage/database-connection';

/** High-level database operations owned by a `DbContext`. */
export interface DatabaseFacade {
    /** Name reported by the configured provider. */
    readonly providerName: string;
    /** Advanced access to the provider-neutral connection contract. */
    readonly connection: DatabaseConnection;
    /** Execute the provider's complete schema-creation plan. */
    ensureCreated(options?: DatabaseOperationOptions): Promise<void>;
    /** Render the provider's complete schema-creation script for the current model. */
    createScript(): string;
    /** Run a parameterized SQL query and return its rows. */
    sql<TRow extends Record<string, unknown> = Record<string, unknown>>(
        strings: TemplateStringsArray,
        ...values: readonly unknown[]
    ): Promise<TRow[]>;
    /** Run a parameterized SQL command and return its affected-row count. */
    execute(
        strings: TemplateStringsArray,
        ...values: readonly unknown[]
    ): Promise<number>;
    /** Execute an already-built parameterized statement. */
    executeStatement(statement: SqlStatement, options?: DatabaseOperationOptions): Promise<number>;
    /** Build a parameterized statement without executing it. */
    rawSql(
        strings: TemplateStringsArray,
        ...values: readonly unknown[]
    ): SqlStatement;
    /** Bind operation options to raw-SQL template calls on a scoped facade. */
    withOptions(options: DatabaseOperationOptions): DatabaseFacade;
}
