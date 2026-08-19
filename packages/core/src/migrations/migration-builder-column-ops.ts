import type { AlterColumnChange } from '../sql/sql-dialect';
import type { MigrationBuilderCore } from './migration-builder-core';
import { renderColumn } from './migration-builder-column-render';
import type { MigrationAlterColumnDefinition, MigrationColumnDefinition } from './migration-builder-types';
import {
    assertExclusiveStoreGeneration,
    hasStoreGenerationChange,
    mustDropDefaultBeforeStoreGeneration,
} from './migration-builder-store-generation';

/** DDL that mutates columns on an existing table. */
export function addColumn(core: MigrationBuilderCore, tableName: string, column: MigrationColumnDefinition, schemaName?: string): void {
    core.emitDdl(`alter table ${core.dialect.quoteQualifiedIdentifier(schemaName, tableName)} add column ${renderColumn(column, core.dialect)}`);
}

export function dropColumn(core: MigrationBuilderCore, tableName: string, columnName: string, schemaName?: string): void {
    core.emitDdl(`alter table ${core.dialect.quoteQualifiedIdentifier(schemaName, tableName)} drop column ${core.dialect.quoteIdentifier(columnName)}`);
}

export function renameColumn(core: MigrationBuilderCore, tableName: string, columnName: string, newColumnName: string, schemaName?: string): void {
    core.emitDdl(`alter table ${core.dialect.quoteQualifiedIdentifier(schemaName, tableName)} rename column ${core.dialect.quoteIdentifier(columnName)} to ${core.dialect.quoteIdentifier(newColumnName)}`);
}

/**
 * Alter a column's name, type, nullability, or default.
 */
export function alterColumn(core: MigrationBuilderCore, tableName: string, column: MigrationAlterColumnDefinition, schemaName?: string): void {
    assertExclusiveStoreGeneration(column);
    const table = core.dialect.quoteQualifiedIdentifier(schemaName, tableName);
    const quotedColumn = core.dialect.quoteIdentifier(column.name);
    if (column.oldName && column.oldName !== column.name) {
        renameColumn(core, tableName, column.oldName, column.name, schemaName);
    }

    const typeChanged = Boolean(column.type) && column.type !== column.oldType;
    const nullabilityChanged = column.nullable !== undefined && column.nullable !== column.oldNullable;
    const defaultChanged = column.defaultSql !== column.oldDefaultSql;
    const computedChanged =
        column.computedSql !== column.oldComputedSql ||
        column.computedStored !== column.oldComputedStored;
    const collationChanged = column.collation !== column.oldCollation;
    const storeGenerationChanged = hasStoreGenerationChange(column);
    const definitionChanged = typeChanged || nullabilityChanged ||
        computedChanged || collationChanged || storeGenerationChanged;
    let defaultHandled = false;

    if (definitionChanged || defaultChanged) {
    // Any in-place column change — including a bare default — needs the
    // capability. SQLite has no `alter column` at all.
        core.assertCapability(
            core.supportsColumnAlteration,
            'alterColumn',
            'Rebuild the table with the new column definition instead, because this provider cannot alter a column in place.',
        );
    }

    if (definitionChanged) {
        const effectiveNullable = column.nullable ?? column.oldNullable ?? true;
        const change: AlterColumnChange = {
            typeChanged,
            nullabilityChanged,
            defaultChanged,
            computedChanged,
            collationChanged,
            storeGenerationChanged,
            resolvedType: column.type,
            resolvedNotNull: !effectiveNullable,
            resolvedDefaultSql: defaultChanged ? column.defaultSql : column.oldDefaultSql,
            resolvedComputedSql: computedChanged
                ? column.computedSql
                : column.oldComputedSql,
            resolvedComputedStored: computedChanged
                ? column.computedStored
                : column.oldComputedStored,
            resolvedCollation: collationChanged
                ? column.collation
                : column.oldCollation,
            resolvedStoreGeneration: storeGenerationChanged
                ? column.storeGeneration
                : column.oldStoreGeneration,
        };
        const storeGenerationStatements = storeGenerationChanged
            ? core.dialect.alterStoreGenerationStatements?.(
                table,
                quotedColumn,
                column.storeGeneration,
                column.oldStoreGeneration,
                column.type,
            )
            : undefined;
        const provided = core.dialect.alterColumnStatements?.(table, quotedColumn, change);
        if (provided !== undefined) {
            // The provider owns the whole column (MySQL restates type, nullability,
            // and default together), so the default is handled here.
            for (const statement of provided) {
                core.emitDdl(statement);
            }
            defaultHandled = true;
        } else {
            if (storeGenerationChanged && storeGenerationStatements === undefined) {
                throw new Error(
                    `Migration operation 'alterColumn(storeGeneration)' is not supported by provider '${core.providerName}'. Rebuild the column or use reviewed provider SQL.`,
                );
            }
            if (computedChanged) {
                throw new Error(
                    `Migration operation 'alterColumn(computedSql)' is not supported by provider '${core.providerName}'. Drop and recreate the generated column with reviewed migration SQL.`,
                );
            }
            if (
                storeGenerationChanged &&
                mustDropDefaultBeforeStoreGeneration(column)
            ) {
                core.emitDdl(
                    `alter table ${table} alter column ${quotedColumn} drop default`,
                );
                defaultHandled = true;
            }
            if (typeChanged) {
                const collation = column.collation
                    ? ` collate ${core.dialect.quoteIdentifier(column.collation)}`
                    : '';
                core.emitDdl(`alter table ${table} alter column ${quotedColumn} type ${column.type}${collation}`);
            } else if (collationChanged) {
                const collation = core.dialect.quoteIdentifier(
                    column.collation ?? 'default',
                );
                core.emitDdl(`alter table ${table} alter column ${quotedColumn} type ${column.type} collate ${collation}`);
            }
            if (nullabilityChanged) {
                core.emitDdl(`alter table ${table} alter column ${quotedColumn} ${column.nullable ? 'drop' : 'set'} not null`);
            }
        }
        for (const statement of storeGenerationStatements ?? []) {
            core.emitDdl(statement);
        }
    }

    if (defaultChanged && !defaultHandled) {
    // `alter column ... set/drop default` is portable across Postgres and MySQL.
        core.emitDdl(column.defaultSql === undefined
            ? `alter table ${table} alter column ${quotedColumn} drop default`
            : `alter table ${table} alter column ${quotedColumn} set default ${column.defaultSql}`);
    }
}
