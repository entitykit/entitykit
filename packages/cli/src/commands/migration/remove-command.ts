import { removeLatestMigration } from '../../../migrations/migration-commands';
import { parseCommandArguments } from '../../cli-command-parser';
import type { ParsedGlobalOptions } from '../../cli-option-reader';
import { CliUsageError } from '../../cli-usage-error';
import { loadCliConfig } from '../../cli-runtime';
import { ok, type EntityKitCliOptions, type EntityKitCliResult } from '../../cli-result';
import { readAppliedMigrationHistory } from '../provider-connection';

/** Remove the latest local migration after proving it is unapplied. */
export async function runMigrationRemoveCommand(
    args: readonly string[],
    global: ParsedGlobalOptions,
    options: EntityKitCliOptions,
): Promise<EntityKitCliResult> {
    const parsed = parseCommandArguments(args, 'migration remove');
    if (parsed.positionals.length > 0) {
        throw new CliUsageError('migration remove does not accept positional arguments.');
    }
    const config = await loadCliConfig(global, options);
    const applied = parsed.has('--offline')
        ? undefined
        : await requiredMigrationHistory(config, options.signal);
    const removed = await removeLatestMigration({
        migrationsDir: config.migrationsDir,
        snapshotPath: config.snapshot,
        appliedMigrationIds: applied?.map(row => row.id),
    });
    return ok(
        `Removed migration ${removed.removedMigrationId}.\n` +
        `Restored previous model snapshot: ${removed.restoredSnapshot ? 'yes' : 'no'}.`,
        removed,
    );
}

async function requiredMigrationHistory(
    config: Parameters<typeof readAppliedMigrationHistory>[0],
    signal?: AbortSignal,
): Promise<NonNullable<Awaited<ReturnType<typeof readAppliedMigrationHistory>>>> {
    const history = await readAppliedMigrationHistory(config, signal);
    if (!history) {
        throw new Error('migration remove requires a database connection. Use --offline to skip the applied-migration check.');
    }
    return history;
}
