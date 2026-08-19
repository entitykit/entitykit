import { listMigrations } from '../../../migrations/migration-commands';
import { parseCommandArguments } from '../../cli-command-parser';
import type { ParsedGlobalOptions } from '../../cli-option-reader';
import { loadCliConfig } from '../../cli-runtime';
import { CliUsageError } from '../../cli-usage-error';
import { ok, type EntityKitCliOptions, type EntityKitCliResult } from '../../cli-result';

/** List only local, source-controlled migration artifacts. */
export async function runMigrationListCommand(
    args: readonly string[],
    global: ParsedGlobalOptions,
    options: EntityKitCliOptions,
): Promise<EntityKitCliResult> {
    const parsed = parseCommandArguments(args, 'migration list');
    if (parsed.positionals.length > 0) {
        throw new CliUsageError('migration list does not accept positional arguments.');
    }
    const config = await loadCliConfig(global, options);
    const migrations = await listMigrations(config.migrationsDir);
    const data = migrations.map(item => ({
        id: item.migration.id,
        name: item.migration.name,
    }));
    return ok(
        data.length === 0
            ? 'No migrations found.'
            : data.map(item => `  ${item.id} ${item.name}`).join('\n'),
        { migrations: data },
    );
}
