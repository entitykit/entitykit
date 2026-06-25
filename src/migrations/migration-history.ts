import type { Migration } from './migration';
import { migrationChecksum } from './migration-metadata';
import { postgresMigrationDialect, type MigrationSqlDialect } from './migration-sql-dialect';
import type { SqlStatement } from '../sql/sql-statement';
export {
    entityKitMigrationVersion,
    migrationChecksum,
    migrationHistoryTableName,
    migrationLockKey,
} from './migration-metadata';

/** One migration history row. */ export interface MigrationHistoryRow {
    /** The id. */ readonly id: string;
    /** Stable name for this contract or database object. */ readonly name: string;
    /** The checksum. */ readonly checksum: string;
    /** The entity kit version. */ readonly entityKitVersion?: string;
    /** The applied at. */ readonly appliedAt?: Date | string;
}

export function createMigrationHistoryTableStatement(dialect: MigrationSqlDialect = postgresMigrationDialect): SqlStatement {
    return dialect.createMigrationHistoryTableStatement();
}

export function selectMigrationHistoryStatement(dialect: MigrationSqlDialect = postgresMigrationDialect): SqlStatement {
    return dialect.selectMigrationHistoryStatement();
}

export function insertMigrationHistoryStatement(
    migration: Migration,
    dialect: MigrationSqlDialect = postgresMigrationDialect,
    checksum = migrationChecksum(migration, dialect.sql),
): SqlStatement {
    return dialect.insertMigrationHistoryStatement(migration, checksum);
}

export function deleteMigrationHistoryStatement(migration: Migration, dialect: MigrationSqlDialect = postgresMigrationDialect): SqlStatement {
    return dialect.deleteMigrationHistoryStatement(migration);
}

export function acquireMigrationLockStatement(dialect: MigrationSqlDialect = postgresMigrationDialect): SqlStatement | undefined {
    return dialect.acquireMigrationLockStatement?.();
}

export function releaseMigrationLockStatement(dialect: MigrationSqlDialect = postgresMigrationDialect): SqlStatement | undefined {
    return dialect.releaseMigrationLockStatement?.();
}
