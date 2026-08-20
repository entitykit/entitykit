import { listMigrations } from '@entitykit/core/migrations';
import { parseCommandArguments } from '../../cli-command-parser';
import type { ParsedGlobalOptions } from '../../cli-option-reader';
import { CliUsageError } from '../../cli-usage-error';
import { loadCliConfig } from '../../cli-runtime';
import { difference, ok, type EntityKitCliOptions, type EntityKitCliResult } from '../../cli-result';
import { createMigrationStatus, renderMigrationStatus } from '../../output/migration-status';
import { readAppliedMigrationHistory } from '../provider-connection';

/** Compare source-controlled migrations with a live database. */
export async function runDbStatusCommand(
    args: readonly string[],
    global: ParsedGlobalOptions,
    options: EntityKitCliOptions,
): Promise<EntityKitCliResult> {
    const parsed = parseCommandArguments(args, 'db status');
    if (parsed.positionals.length > 0) {
        throw new CliUsageError('db status does not accept positional arguments.');
    }
    const config = await loadCliConfig(global, options);
    const applied = await readAppliedMigrationHistory(config, options.signal);
    if (!applied) {
        throw new Error('db status requires connection in entitykit config or DATABASE_URL.');
    }
    const migrations = await listMigrations(config.migrationsDir);
    const status = createMigrationStatus(
        migrations,
        applied,
        config.provider.migrationDialect,
        config.provider.createMigrationBuilder,
    );
    const text = renderMigrationStatus(status);
    return parsed.has('--check') && !status.clean
        ? difference(text, status)
        : ok(text, status);
}
