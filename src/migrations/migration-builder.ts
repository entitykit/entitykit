import type { SqlDialect } from '../sql/sql-dialect';
import * as ColumnOps from './migration-builder-column-ops';
import * as SequenceOps from './migration-builder-sequence-ops';
import * as RebuildOps from './migration-builder-rebuild-ops';
import { MigrationBuilderConstraints } from './migration-builder-constraints';
import type {
    MigrationAlterColumnDefinition,
    MigrationBuilderOptions,
    MigrationColumnDefinition,
    MigrationSequenceDefinition,
    MigrationTableRebuildDefinition,
} from './migration-builder-types';

// Re-export every declaration that historically lived in this module so it stays
// importable from "./migration-builder" and through the public migrations entrypoint.
export type {
    MigrationAlterColumnDefinition,
    MigrationBuilderOptions,
    MigrationColumnDefinition,
    MigrationCreateTableOptions,
    MigrationDropIndexOptions,
    MigrationForeignKeyDefinition,
    MigrationIndexDefinition,
    MigrationSqlOptions,
    MigrationStatement,
    MigrationTableForeignKey,
    MigrationCheckConstraint,
    MigrationIndexKeyPart,
    MigrationSequenceDefinition,
    MigrationTableCopyColumn,
    MigrationTableRebuildDefinition,
    MigrationTableShape,
} from './migration-builder-types';
export { MigrationColumnBuilder } from './migration-column-builder';
export { MigrationTableBuilder } from './migration-table-builder';
export type { MigrationTableCallback } from './migration-table-builder';

/**
 * Collects SQL operations for a migration.
 *
 * The builder holds a single `MigrationBuilderCore` (shared state, dialect,
 * and capability gating) and delegates each operation to the category module that
 * owns that DDL — table/schema/extension, column, constraint, or index — while
 * this class keeps the fluent `this`-returning surface the callers depend on.
 */
export class MigrationBuilder extends MigrationBuilderConstraints {
    constructor(
        dialect?: SqlDialect,
        options: MigrationBuilderOptions = {},
    ) {
        super(dialect, options);
    }

    /**
   * Add a column to an existing table.
   */
    public addColumn(tableName: string, column: MigrationColumnDefinition, schemaName?: string): this {
        ColumnOps.addColumn(this.core, tableName, column, schemaName);
        return this;
    }

    public dropColumn(tableName: string, columnName: string, schemaName?: string): this {
        ColumnOps.dropColumn(this.core, tableName, columnName, schemaName);
        return this;
    }

    public renameColumn(tableName: string, columnName: string, newColumnName: string, schemaName?: string): this {
        ColumnOps.renameColumn(this.core, tableName, columnName, newColumnName, schemaName);
        return this;
    }

    /**
   * Alter a column's name, type, nullability, or default.
   */
    public alterColumn(tableName: string, column: MigrationAlterColumnDefinition, schemaName?: string): this {
        ColumnOps.alterColumn(this.core, tableName, column, schemaName);
        return this;
    }

    public createSequence(sequence: MigrationSequenceDefinition): this {
        SequenceOps.createSequence(this.core, sequence);
        return this;
    }

    public alterSequence(
        sequence: MigrationSequenceDefinition,
        previous: MigrationSequenceDefinition,
    ): this {
        SequenceOps.alterSequence(this.core, sequence, previous);
        return this;
    }

    public dropSequence(sequence: MigrationSequenceDefinition): this {
        SequenceOps.dropSequence(this.core, sequence);
        return this;
    }

    public rebuildTable(definition: MigrationTableRebuildDefinition): this {
        RebuildOps.rebuildTable(this.core, definition);
        return this;
    }
}
