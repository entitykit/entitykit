import type { Migration } from '@entitykit/core/migrations';
import { migrationChecksum, type MigrationHistoryRow } from '@entitykit/core/migrations';
import type { MigrationBuilderFactory } from '@entitykit/core/adapter';
import { MigrationSqlGenerator } from '@entitykit/core/migrations';
import type { MigrationSqlDialect } from '@entitykit/core/adapter';
import {
    createMigrationUpdatePlan,
    type MigrationUpdatePlan,
} from '@entitykit/core/migrations';

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
