import type { MigrationBuilderCore } from './migration-builder-core';
import { collectTableColumns, type MigrationTableCallback } from './migration-table-builder';
import { renderColumn } from './migration-builder-column-render';
import type {
    MigrationColumnDefinition,
    MigrationCreateTableOptions,
} from './migration-builder-types';

/**
 * WHY: DDL that creates and drops whole database objects — schemas, tables, and
 * extensions — plus renaming a table. Grouped because these operations bring an
 * object into (or out of) existence, as opposed to the column/constraint/index
 * modules that mutate the shape of an existing table. `MigrationBuilder`
 * delegates each of its matching methods here, passing the shared core.
 */

/**
 * Add a `create schema if not exists` operation.
 */
export function createSchema(core: MigrationBuilderCore, schemaName: string): void {
    core.emitDdl(`create schema if not exists ${core.dialect.quoteIdentifier(schemaName)}`);
}

export function dropSchema(core: MigrationBuilderCore, schemaName: string): void {
    core.emitDdl(`drop schema if exists ${core.dialect.quoteIdentifier(schemaName)}`);
}

export function createTable(
    core: MigrationBuilderCore,
    tableName: string,
    columns: readonly MigrationColumnDefinition[] | MigrationTableCallback,
    schemaName?: string,
    options: MigrationCreateTableOptions = {},
    ifNotExists = true,
): void {
    const definitions = typeof columns === 'function' ? collectTableColumns(columns) : columns;
    if (definitions.length === 0) {
        throw new Error('createTable requires at least one column.');
    }

    // A key spanning several columns needs a table-level constraint; rendering
    // `primary key` inline on each column would be invalid SQL. Dropping the
    // flag leaves `not null`, which is what a key column needs anyway.
    const primaryKeyColumns = definitions.filter(column => column.primaryKey);
    if (options.primaryKeyName !== undefined && !options.primaryKeyName.trim()) {
        throw new Error('createTable primaryKeyName requires a non-empty name.');
    }
    if (options.primaryKeyName && primaryKeyColumns.length === 0) {
        throw new Error(
            'createTable primaryKeyName requires at least one primary-key column.',
        );
    }
    const useTableConstraint =
        primaryKeyColumns.length > 1 ||
        primaryKeyColumns.length === 1 && Boolean(options.primaryKeyName);
    const columnSql = definitions
        .map(column => renderColumn(
            useTableConstraint ? { ...column, primaryKey: false } : column,
            core.dialect,
            Boolean(column.primaryKey),
        ))
        .join(', ');
    const primaryKeyPrefix = options.primaryKeyName
        ? `constraint ${core.dialect.quoteIdentifier(options.primaryKeyName)} `
        : '';
    const parts = useTableConstraint
        ? [columnSql, `${primaryKeyPrefix}primary key (${primaryKeyColumns.map(column => core.dialect.quoteIdentifier(column.name)).join(', ')})`]
        : [columnSql];

    for (const foreignKey of options.foreignKeys ?? []) {
        if (foreignKey.columns.length === 0 || foreignKey.principalColumns.length === 0) {
            throw new Error('createTable foreign keys require at least one local and principal column.');
        }

        const localColumns = foreignKey.columns.map(column => core.dialect.quoteIdentifier(column)).join(', ');
        const principalColumns = foreignKey.principalColumns.map(column => core.dialect.quoteIdentifier(column)).join(', ');
        const onDelete = foreignKey.onDelete ? ` on delete ${foreignKey.onDelete}` : '';
        parts.push(
            `constraint ${core.dialect.quoteIdentifier(foreignKey.name)} foreign key (${localColumns}) references ${core.dialect.quoteQualifiedIdentifier(foreignKey.principalSchemaName, foreignKey.principalTableName)} (${principalColumns})${onDelete}`,
        );
    }
    for (const check of options.checkConstraints ?? []) {
        if (!check.name.trim() || !check.sql.trim()) {
            throw new Error('createTable check constraints require a name and SQL expression.');
        }
        parts.push(
            `constraint ${core.dialect.quoteIdentifier(check.name)} check (${check.sql})`,
        );
    }

    const guard = ifNotExists ? ' if not exists' : '';
    core.emitDdl(`create table${guard} ${core.dialect.quoteQualifiedIdentifier(schemaName, tableName)} (${parts.join(', ')})`);
}

export function dropTable(core: MigrationBuilderCore, tableName: string, schemaName?: string): void {
    core.emitDdl(`drop table if exists ${core.dialect.quoteQualifiedIdentifier(schemaName, tableName)}`);
}

export function renameTable(core: MigrationBuilderCore, tableName: string, newTableName: string, schemaName?: string): void {
    core.emitDdl(`alter table ${core.dialect.quoteQualifiedIdentifier(schemaName, tableName)} rename to ${core.dialect.quoteIdentifier(newTableName)}`);
}

export function createExtension(core: MigrationBuilderCore, extensionName: string, schemaName?: string): void {
    core.assertCapability(
        core.supportsExtensions,
        'createExtension',
        'Implement extension DDL in the provider migration builder, expose a provider-specific helper, or use builder.sql(...) with reviewed provider SQL.',
    );
    const schemaSql = schemaName ? ` with schema ${core.dialect.quoteIdentifier(schemaName)}` : '';
    core.emitDdl(`create extension if not exists ${core.dialect.quoteIdentifier(extensionName)}${schemaSql}`);
}

export function dropExtension(core: MigrationBuilderCore, extensionName: string): void {
    core.assertCapability(
        core.supportsExtensions,
        'dropExtension',
        'Implement extension DDL in the provider migration builder, expose a provider-specific helper, or use builder.sql(...) with reviewed provider SQL.',
    );
    core.emitDdl(`drop extension if exists ${core.dialect.quoteIdentifier(extensionName)}`);
}
