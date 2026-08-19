import type { DatabaseConnection, DatabaseOperationOptions } from '../../storage/database-connection';
import {
    createMigrationHistoryTableStatement,
    selectMigrationHistoryStatement,
    type MigrationHistoryRow,
} from '../migration-history';
import type { MigrationSqlDialect } from '../migration-sql-dialect';

export async function readMigrationHistory(
    database: DatabaseConnection,
    dialect: MigrationSqlDialect,
    options?: DatabaseOperationOptions,
    mode: MigrationHistoryReadMode = 'initialize',
): Promise<MigrationHistoryRow[]> {
    if (mode === 'initialize') {
        await database.query(createMigrationHistoryTableStatement(dialect), options);
    } else if (dialect.migrationHistoryTableExistsStatement) {
        const exists = await database.query<{ readonly exists: unknown }>(
            dialect.migrationHistoryTableExistsStatement(),
            options,
        );
        if (!databaseBoolean(exists.rows[0]?.exists)) {
            return [];
        }
    } else {
        throw new Error(
            `Migration dialect '${dialect.name}' cannot inspect migration history without changing the database.`,
        );
    }
    const result = await database.query<MigrationHistoryDatabaseRow>(
        selectMigrationHistoryStatement(dialect),
        options,
    );
    return result.rows.map(row => ({
        id: row.id,
        name: row.name,
        checksum: row.checksum,
        ...readOptionalString(row, 'entityKitVersion', 'entitykit_version'),
        ...readOptionalDate(row, 'appliedAt', 'applied_at'),
    }));
}

export type MigrationHistoryReadMode = 'check' | 'initialize';

function databaseBoolean(value: unknown): boolean {
    return value === true || value === 1 || value === 1n || value === '1';
}

interface MigrationHistoryDatabaseRow extends Record<string, unknown> {
    readonly id: string;
    readonly name: string;
    readonly checksum: string;
}

function readOptionalString(
    row: MigrationHistoryDatabaseRow,
    property: 'entityKitVersion',
    databaseColumn: 'entitykit_version',
): Pick<MigrationHistoryRow, 'entityKitVersion'> {
    const value = row[property] ?? row[databaseColumn];
    return typeof value === 'string' ? { entityKitVersion: value } : {};
}

function readOptionalDate(
    row: MigrationHistoryDatabaseRow,
    property: 'appliedAt',
    databaseColumn: 'applied_at',
): Pick<MigrationHistoryRow, 'appliedAt'> {
    const value = row[property] ?? row[databaseColumn];
    return value instanceof Date || typeof value === 'string'
        ? { appliedAt: value }
        : {};
}
