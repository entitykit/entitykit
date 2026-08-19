import type { Migration } from '../migrations/migration';
import { migrationChecksum, type MigrationHistoryRow } from '../migrations/migration-history';
import type { MigrationBuilderFactory } from '../migrations/migration-builder-contract';
import { MigrationSqlGenerator } from '../migrations/migration-sql-generator';
import type { MigrationSqlDialect } from '../migrations/migration-sql-dialect';
import {
    createMigrationUpdatePlan,
    type MigrationUpdatePlan,
} from '../migrations/runner/migration-update-plan';

/** A validated live-database migration plan plus its exact reviewable SQL. */
export interface CliMigrationPlan extends MigrationUpdatePlan {
    /** SQL generated from the same range execution will consume. */ readonly script: string;
}

/** Build one plan used by both `db migrate --dry-run` and execution internals. */
export function createCliMigrationPlan(
    migrations: readonly Migration[],
    applied: readonly MigrationHistoryRow[],
    dialect: MigrationSqlDialect,
    createMigrationBuilder: MigrationBuilderFactory,
    target?: string,
): CliMigrationPlan {
    const normalizedTarget = target?.toLowerCase() === 'latest' ? 'Latest' : target;
    const plan = createMigrationUpdatePlan(
        migrations,
        applied,
        migration => migrationChecksum(migration, dialect.sql, createMigrationBuilder),
        normalizedTarget,
    );
    const script = new MigrationSqlGenerator(dialect, createMigrationBuilder)
        .generateScript(migrations, { from: plan.from, to: plan.target });
    return { ...plan, script };
}
