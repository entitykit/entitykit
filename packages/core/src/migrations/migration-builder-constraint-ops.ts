import type { MigrationBuilderCore } from './migration-builder-core';
import type { MigrationForeignKeyDefinition } from './migration-builder-types';

/**
 * WHY: DDL for the integrity constraints layered onto an existing table —
 * primary keys, unique constraints, and foreign keys, each added or dropped via
 * `alter table`. Grouped together (and apart from indexes) because they share
 * the `supportsAlterTableConstraints` capability gate and the provider-specific
 * `dropConstraint` clause on the core. `MigrationBuilder` delegates here.
 */

export function addPrimaryKey(core: MigrationBuilderCore, tableName: string, constraintName: string, columns: readonly string[], schemaName?: string): void {
    if (columns.length === 0) {
        throw new Error('addPrimaryKey requires at least one column.');
    }
    core.emitDdl(`alter table ${core.dialect.quoteQualifiedIdentifier(schemaName, tableName)} add constraint ${core.dialect.quoteIdentifier(constraintName)} primary key (${columns.map(column => core.dialect.quoteIdentifier(column)).join(', ')})`);
}

export function dropPrimaryKey(core: MigrationBuilderCore, tableName: string, constraintName: string, schemaName?: string): void {
    core.assertCapability(
        core.supportsAlterTableConstraints,
        'dropPrimaryKey',
        'Rebuild the table without the primary key instead, because this provider cannot drop constraints from an existing table.',
    );
    core.dropConstraint('primaryKey', tableName, constraintName, schemaName);
}

export function addUniqueConstraint(core: MigrationBuilderCore, tableName: string, constraintName: string, columns: readonly string[], schemaName?: string): void {
    if (columns.length === 0) {
        throw new Error('addUniqueConstraint requires at least one column.');
    }
    core.emitDdl(`alter table ${core.dialect.quoteQualifiedIdentifier(schemaName, tableName)} add constraint ${core.dialect.quoteIdentifier(constraintName)} unique (${columns.map(column => core.dialect.quoteIdentifier(column)).join(', ')})`);
}

export function dropUniqueConstraint(core: MigrationBuilderCore, tableName: string, constraintName: string, schemaName?: string): void {
    core.assertCapability(
        core.supportsAlterTableConstraints,
        'dropUniqueConstraint',
        'Rebuild the table without the constraint instead, because this provider cannot drop constraints from an existing table.',
    );
    core.dropConstraint('unique', tableName, constraintName, schemaName);
}

/**
 * Add a foreign-key constraint operation.
 */
export function addForeignKey(core: MigrationBuilderCore, foreignKey: MigrationForeignKeyDefinition): void {
    if (foreignKey.columns.length === 0 || foreignKey.principalColumns.length === 0) {
        throw new Error('addForeignKey requires at least one local and principal column.');
    }

    core.assertCapability(
        core.supportsAlterTableConstraints,
        'addForeignKey',
        'Declare the foreign key in createTable(...) instead, or rebuild the table, because this provider cannot add constraints to an existing table.',
    );

    const columns = foreignKey.columns.map(column => core.dialect.quoteIdentifier(column)).join(', ');
    const principalColumns = foreignKey.principalColumns.map(column => core.dialect.quoteIdentifier(column)).join(', ');
    const onDelete = foreignKey.onDelete ? ` on delete ${foreignKey.onDelete}` : '';
    core.emitDdl(
        `alter table ${core.dialect.quoteQualifiedIdentifier(foreignKey.schemaName, foreignKey.tableName)} add constraint ${core.dialect.quoteIdentifier(foreignKey.name)} foreign key (${columns}) references ${core.dialect.quoteQualifiedIdentifier(foreignKey.principalSchemaName, foreignKey.principalTableName)} (${principalColumns})${onDelete}`,
    );
}

export function dropForeignKey(core: MigrationBuilderCore, tableName: string, constraintName: string, schemaName?: string): void {
    core.assertCapability(
        core.supportsAlterTableConstraints,
        'dropForeignKey',
        'Rebuild the table without the constraint instead, because this provider cannot drop constraints from an existing table.',
    );
    core.dropConstraint('foreignKey', tableName, constraintName, schemaName);
}

export function addCheckConstraint(
    core: MigrationBuilderCore,
    tableName: string,
    constraintName: string,
    sql: string,
    schemaName?: string,
): void {
    if (!sql.trim()) {
        throw new Error('addCheckConstraint requires a SQL expression.');
    }
    core.assertCapability(
        core.supportsAlterTableConstraints,
        'addCheckConstraint',
        'Rebuild the table with the check constraint declared in createTable(...).',
    );
    core.emitDdl(
        `alter table ${core.dialect.quoteQualifiedIdentifier(schemaName, tableName)} add constraint ${core.dialect.quoteIdentifier(constraintName)} check (${sql})`,
    );
}

export function dropCheckConstraint(
    core: MigrationBuilderCore,
    tableName: string,
    constraintName: string,
    schemaName?: string,
): void {
    core.assertCapability(
        core.supportsAlterTableConstraints,
        'dropCheckConstraint',
        'Rebuild the table without the check constraint.',
    );
    core.dropConstraint('check', tableName, constraintName, schemaName);
}
