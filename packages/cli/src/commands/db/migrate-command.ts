import path from 'node:path';
import { PendingModelChangesError } from '@entitykit/core/migrations';
import { contextMigrations } from '@entitykit/core/migrations';
import { hasPendingModelChanges, listMigrations } from '@entitykit/core/migrations';
import { MigrationRunner } from '@entitykit/core/migrations';
import { writeFilesAtomically } from '@entitykit/core/tooling';
import { parseCommandArguments } from '../../cli-command-parser';
import type { ParsedGlobalOptions } from '../../cli-option-reader';
import { CliUsageError } from '../../cli-usage-error';
import { loadCliConfig } from '../../cli-runtime';
import { ok, type EntityKitCliOptions, type EntityKitCliResult } from '../../cli-result';
import { resolveEntityKitConnection } from '../../entity-kit-connection-config';
import { createCliMigrationPlan } from '../../migration-plan';
import { renderDatabaseUpdateResult } from '../../output/migration-results';
import { createDatabaseConnection } from '../provider-connection';

/** Preview or execute a migration plan against the live database state. */
export async function runDbMigrateCommand(
    args: readonly string[],
    global: ParsedGlobalOptions,
    options: EntityKitCliOptions,
): Promise<EntityKitCliResult> {
    const parsed = parseCommandArguments(args, 'db migrate');
    if (parsed.positionals.length > 0) {
        throw new CliUsageError('db migrate uses --to; it does not accept a positional target.');
    }
    if (parsed.has('--output') && !parsed.has('--dry-run')) {
        throw new CliUsageError('db migrate --output requires --dry-run so the database is not modified.');
    }
    const config = await loadCliConfig(global, options);
    await assertModelRepresentedByMigration(config);
    const target = normalizeTarget(parsed.value('--to'));
    const connectionConfig = await resolveEntityKitConnection(config);
    if (!connectionConfig) {
        throw new Error('db migrate requires connection in entitykit config or DATABASE_URL.');
    }
    const migrations = await listMigrations(config.migrationsDir);
    const migrationValues = migrations.map(item => item.migration);
    const database = createDatabaseConnection(config.provider, connectionConfig);
    try {
        const runner = new MigrationRunner(
            database,
            config.provider.migrationDialect,
            config.provider.createMigrationBuilder,
        );
        if (parsed.has('--dry-run')) {
            const applied = await runner.getAppliedMigrations({
                signal: options.signal,
                initializeHistory: false,
            });
            const plan = createCliMigrationPlan(
                migrationValues,
                applied,
                config.provider.migrationDialect,
                config.provider.createMigrationBuilder,
                target,
            );
            return renderDryRun(plan, parsed.value('--output'), config.projectRoot);
        }
        const result = await runner.update(migrationValues, {
            target,
            allowDataLoss: parsed.has('--allow-data-loss'),
            signal: options.signal,
        });
        return ok(renderDatabaseUpdateResult(result), {
            steps: result.appliedMigrations,
            target: target ?? 'Latest',
            usedMigrationLock: result.usedMigrationLock,
            transactionSuppressedStatements: result.transactionSuppressedStatements,
        });
    } finally {
        await database.dispose?.();
    }
}

async function assertModelRepresentedByMigration(
    config: Awaited<ReturnType<typeof loadCliConfig>>,
): Promise<void> {
    const context = config.context.create();
    try {
        const pending = hasPendingModelChanges(
            contextMigrations(context),
            { snapshotPath: config.snapshot },
        );
        if (pending.hasPendingChanges) {
            throw new PendingModelChangesError(pending.operations);
        }
    } finally {
        await context.dispose();
    }
}

function renderDryRun(
    plan: ReturnType<typeof createCliMigrationPlan>,
    output: string | undefined,
    projectRoot: string,
): EntityKitCliResult {
    const warnings = plan.warnings.map(message => ({ code: 'MIGRATION_DATA_LOSS', message }));
    const steps = plan.steps.map(step => `${step.direction}:${step.migration.id}`);
    if (!output) {
        return ok(plan.script, {
            from: plan.from,
            target: plan.target,
            steps,
            script: plan.script,
        }, warnings);
    }
    const outputPath = path.resolve(projectRoot, output);
    writeFilesAtomically([{ path: outputPath, contents: plan.script }]);
    const relativeOutput = path.relative(projectRoot, outputPath);
    return ok(`Wrote dry-run migration plan to ${relativeOutput}.`, {
        from: plan.from,
        target: plan.target,
        steps,
        outputPath: relativeOutput,
    }, warnings);
}

function normalizeTarget(value: string | undefined): string | undefined {
    return value?.toLowerCase() === 'latest' ? 'Latest' : value;
}
