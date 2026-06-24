import type { SqlDialect } from '../sql/sql-dialect';
import * as TableOps from './migration-builder-table-ops';
import { MigrationBuilderCore } from './migration-builder-core';
import type {
    MigrationBuilderOptions,
    MigrationColumnDefinition,
    MigrationCreateTableOptions,
    MigrationSqlOptions,
    MigrationStatement,
} from './migration-builder-types';
import type { MigrationTableCallback } from './migration-table-builder';

/** Owns raw SQL plus schema, table, and extension operations. */
export abstract class MigrationBuilderTableSurface {
    protected readonly core: MigrationBuilderCore;

    protected constructor(
        dialect?: SqlDialect,
        options: MigrationBuilderOptions = {},
    ) {
        this.core = new MigrationBuilderCore(dialect, options);
    }

    public get statements(): readonly MigrationStatement[] {
        return this.core.collectedStatements.map(statement => ({
            text: statement.text,
            values: [...statement.values],
            suppressTransaction: statement.suppressTransaction,
        }));
    }

    public get requiresTableRebuild(): boolean {
        return this.core.requiresTableRebuild;
    }

    public sql(
        text: string,
        values?: readonly unknown[] | MigrationSqlOptions,
        options: MigrationSqlOptions = {},
    ): this {
        this.core.emit(text, values, options);
        return this;
    }

    public createSchema(schemaName: string): this {
        TableOps.createSchema(this.core, schemaName);
        return this;
    }

    public dropSchema(schemaName: string): this {
        TableOps.dropSchema(this.core, schemaName);
        return this;
    }

    public createTable(
        tableName: string,
        columns: readonly MigrationColumnDefinition[] | MigrationTableCallback,
        schemaName?: string,
        options: MigrationCreateTableOptions = {},
    ): this {
        TableOps.createTable(this.core, tableName, columns, schemaName, options);
        return this;
    }

    public dropTable(tableName: string, schemaName?: string): this {
        TableOps.dropTable(this.core, tableName, schemaName);
        return this;
    }

    public renameTable(tableName: string, newTableName: string, schemaName?: string): this {
        TableOps.renameTable(this.core, tableName, newTableName, schemaName);
        return this;
    }

    public createExtension(extensionName: string, schemaName?: string): this {
        TableOps.createExtension(this.core, extensionName, schemaName);
        return this;
    }

    public dropExtension(extensionName: string): this {
        TableOps.dropExtension(this.core, extensionName);
        return this;
    }
}
