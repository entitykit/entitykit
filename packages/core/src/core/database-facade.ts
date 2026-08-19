import type { SqlStatement } from '../sql/sql-statement';
import type { DatabaseConnection, DatabaseOperationOptions } from '../storage/database-connection';
import type { DatabaseFacade } from './database-facade-types';

export interface DatabaseFacadeOperations {
    readonly providerName: () => string;
    readonly connection: () => DatabaseConnection;
    readonly createScript: () => string;
    readonly createStatements: () => readonly string[];
    readonly sql: <TRow extends Record<string, unknown>>(
        options: DatabaseOperationOptions,
        strings: TemplateStringsArray,
        ...values: readonly unknown[]
    ) => Promise<TRow[]>;
    readonly execute: (
        options: DatabaseOperationOptions,
        strings: TemplateStringsArray,
        ...values: readonly unknown[]
    ) => Promise<number>;
    readonly executeStatement: (
        statement: SqlStatement,
        options: DatabaseOperationOptions,
    ) => Promise<number>;
    readonly rawSql: (
        strings: TemplateStringsArray,
        ...values: readonly unknown[]
    ) => SqlStatement;
}

class DatabaseFacadeImplementation implements DatabaseFacade {
    constructor(
        private readonly operations: DatabaseFacadeOperations,
        private readonly scopedOptions: DatabaseOperationOptions = {},
    ) {}

    public get providerName(): string {
        return this.operations.providerName();
    }

    public get connection(): DatabaseConnection {
        return this.operations.connection();
    }

    public async ensureCreated(options?: DatabaseOperationOptions): Promise<void> {
        for (const text of this.operations.createStatements()) {
            await this.connection.query(
                { text, values: [] },
                options ?? this.scopedOptions,
            );
        }
    }

    public createScript(): string {
        return this.operations.createScript();
    }

    public async sql<TRow extends Record<string, unknown> = Record<string, unknown>>(
        strings: TemplateStringsArray,
        ...values: readonly unknown[]
    ): Promise<TRow[]> {
        return this.operations.sql<TRow>(this.scopedOptions, strings, ...values);
    }

    public async execute(
        strings: TemplateStringsArray,
        ...values: readonly unknown[]
    ): Promise<number> {
        return this.operations.execute(this.scopedOptions, strings, ...values);
    }

    public async executeStatement(
        statement: SqlStatement,
        options?: DatabaseOperationOptions,
    ): Promise<number> {
        return this.operations.executeStatement(
            statement,
            options ?? this.scopedOptions,
        );
    }

    public rawSql(
        strings: TemplateStringsArray,
        ...values: readonly unknown[]
    ): SqlStatement {
        return this.operations.rawSql(strings, ...values);
    }

    public withOptions(options: DatabaseOperationOptions): DatabaseFacade {
        return new DatabaseFacadeImplementation(this.operations, options);
    }

}

export function createDatabaseFacade(
    operations: DatabaseFacadeOperations,
): DatabaseFacade {
    return new DatabaseFacadeImplementation(operations);
}
