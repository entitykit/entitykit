import { hasPendingModelChanges } from '@entitykit/core/migrations';
import { contextMigrations } from '@entitykit/core/migrations';
import { parseCommandArguments } from '../../cli-command-parser';
import type { ParsedGlobalOptions } from '../../cli-option-reader';
import { loadCliConfig } from '../../cli-runtime';
import { CliUsageError } from '../../cli-usage-error';
import { difference, ok, type EntityKitCliOptions, type EntityKitCliResult } from '../../cli-result';

/** Compare the current model with its source-controlled snapshot. */
export async function runMigrationCheckCommand(
    args: readonly string[],
    global: ParsedGlobalOptions,
    options: EntityKitCliOptions,
): Promise<EntityKitCliResult> {
    const parsed = parseCommandArguments(args, 'migration check');
    if (parsed.positionals.length > 0) {
        throw new CliUsageError('migration check does not accept positional arguments.');
    }
    const config = await loadCliConfig(global, options);
    const context = config.context.create();
    try {
        const pending = hasPendingModelChanges(
            contextMigrations(context),
            { snapshotPath: config.snapshot },
        );
        const data = {
            hasPendingChanges: pending.hasPendingChanges,
            operations: pending.operations,
            warnings: pending.warnings,
        };
        return pending.hasPendingChanges
            ? difference(`Pending model changes found (${String(pending.operations)} operation(s)).`, data)
            : ok('No pending model changes.', data);
    } finally {
        await context.dispose();
    }
}
