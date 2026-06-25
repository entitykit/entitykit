import {
    entityKitMigrationVersion,
    migrationHistoryTableName,
    migrationLockKey,
} from './migration-metadata';
import { postgresDialect, type SqlDialect } from '../sql/sql-dialect';
import type { SqlStatement } from '../sql/sql-statement';
import type { DatabaseQueryResult } from '../storage/database-connection';
import { MigrationError } from '../errors/migration-errors';

/** Migration fields needed by history tables and idempotent script wrappers. */
export interface MigrationIdentity {
    /** The id. */ readonly id: string;
    /** Stable name for this contract or database object. */ readonly name: string;
}

/** Public contract for migration sql dialect. */ export interface MigrationSqlDialect {
    /** Stable name for this contract or database object. */ readonly name: string;
    /** The sql. */ readonly sql: SqlDialect;
    /** Create migration history table statement. */ createMigrationHistoryTableStatement(): SqlStatement;
    /** Perform the select migration history statement operation. */ selectMigrationHistoryStatement(): SqlStatement;
    /** Read whether the migration history table exists without creating it. */ migrationHistoryTableExistsStatement?(): SqlStatement;
    /** Perform the insert migration history statement operation. */ insertMigrationHistoryStatement(
        migration: MigrationIdentity,
        checksum: string
    ): SqlStatement;
    /** Perform the delete migration history statement operation. */ deleteMigrationHistoryStatement(migration: MigrationIdentity): SqlStatement;
    /** Render idempotent migration block. */ renderIdempotentMigrationBlock?(migration: MigrationIdentity, bodySql: string): string;
    /** Perform the acquire migration lock statement operation. */ acquireMigrationLockStatement?(): SqlStatement;
    /** Perform the release migration lock statement operation. */ releaseMigrationLockStatement?(): SqlStatement;
    /** Perform the validate migration lock acquired operation. */ validateMigrationLockAcquired?(result: DatabaseQueryResult): void;
    /** Perform the validate migration lock released operation. */ validateMigrationLockReleased?(result: DatabaseQueryResult): void;
}

/** Built-in postgres migration dialect. */ export const postgresMigrationDialect: MigrationSqlDialect = Object.freeze({
    name: 'postgres',
    sql: postgresDialect,
    /** Create migration history table statement. */ createMigrationHistoryTableStatement(): SqlStatement {
        return {
            text: `create table if not exists ${postgresDialect.quoteIdentifier(migrationHistoryTableName)} (${postgresDialect.quoteIdentifier('id')} text primary key, ${postgresDialect.quoteIdentifier('name')} text not null, ${postgresDialect.quoteIdentifier('checksum')} text not null, ${postgresDialect.quoteIdentifier('entitykit_version')} text not null, ${postgresDialect.quoteIdentifier('applied_at')} timestamptz not null default now())`,
            values: [],
        };
    },
    /** Perform the select migration history statement operation. */ selectMigrationHistoryStatement(): SqlStatement {
        return {
            text: `select ${postgresDialect.quoteIdentifier('id')}, ${postgresDialect.quoteIdentifier('name')}, ${postgresDialect.quoteIdentifier('checksum')}, ${postgresDialect.quoteIdentifier('entitykit_version')}, ${postgresDialect.quoteIdentifier('applied_at')} from ${postgresDialect.quoteIdentifier(migrationHistoryTableName)} order by ${postgresDialect.quoteIdentifier('id')}`,
            values: [],
        };
    },
    migrationHistoryTableExistsStatement(): SqlStatement {
        return {
            text: `select exists (select 1 from information_schema.tables where table_schema = current_schema() and table_name = ${postgresDialect.parameter(1)}) as ${postgresDialect.quoteIdentifier('exists')}`,
            values: [migrationHistoryTableName],
        };
    },
    /** Perform the insert migration history statement operation. */ insertMigrationHistoryStatement(
        migration: MigrationIdentity,
        checksum: string,
    ): SqlStatement {
        return {
            text: `insert into ${postgresDialect.quoteIdentifier(migrationHistoryTableName)} (${postgresDialect.quoteIdentifier('id')}, ${postgresDialect.quoteIdentifier('name')}, ${postgresDialect.quoteIdentifier('checksum')}, ${postgresDialect.quoteIdentifier('entitykit_version')}) values (${postgresDialect.parameter(1)}, ${postgresDialect.parameter(2)}, ${postgresDialect.parameter(3)}, ${postgresDialect.parameter(4)})`,
            values: [migration.id, migration.name, checksum, entityKitMigrationVersion],
        };
    },
    /** Perform the delete migration history statement operation. */ deleteMigrationHistoryStatement(migration: MigrationIdentity): SqlStatement {
        return {
            text: `delete from ${postgresDialect.quoteIdentifier(migrationHistoryTableName)} where ${postgresDialect.quoteIdentifier('id')} = ${postgresDialect.parameter(1)}`,
            values: [migration.id],
        };
    },
    /** Render idempotent migration block. */ renderIdempotentMigrationBlock(migration: MigrationIdentity, bodySql: string): string {
        const body = bodySql
            .split('\n')
            .map(line => `    ${line}`)
            .join('\n');

        return [
            'do $entitykit$',
            'begin',
            `  if not exists (select 1 from ${postgresDialect.quoteIdentifier(migrationHistoryTableName)} where ${postgresDialect.quoteIdentifier('id')} = ${postgresLiteral(migration.id)}) then`,
            body,
            '  end if;',
            'end',
            '$entitykit$;',
        ].join('\n');
    },
    /** Perform the acquire migration lock statement operation. */ acquireMigrationLockStatement(): SqlStatement {
        return {
            text: `select pg_advisory_lock(hashtext(${postgresDialect.parameter(1)}))`,
            values: [migrationLockKey],
        };
    },
    /** Perform the release migration lock statement operation. */ releaseMigrationLockStatement(): SqlStatement {
        return {
            text: `select pg_advisory_unlock(hashtext(${postgresDialect.parameter(1)}))`,
            values: [migrationLockKey],
        };
    },
    /** Perform the validate migration lock released operation. */ validateMigrationLockReleased(result: DatabaseQueryResult): void {
        const released = result.rows[0]?.pg_advisory_unlock;
        if (released === true) {
            return;
        }
        throw new MigrationError(
            'Postgres failed to release the migration advisory lock.',
            {
                details: {
                    lockPhase: 'lockRelease',
                    result: released ?? null,
                },
            },
        );
    },
});

function postgresLiteral(value: unknown): string {
    if (value === null) {
        return 'null';
    }

    if (value instanceof Date) {
        return `'${value.toISOString().replace(/'/g, '\'\'')}'`;
    }

    if (
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        typeof value === 'bigint'
    ) {
        return String(value);
    }

    if (typeof value === 'string') {
        return `'${value.replace(/'/g, '\'\'')}'`;
    }

    throw new TypeError(`Postgres migration literals do not support ${typeof value} values.`);
}
