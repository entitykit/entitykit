import type { ParsedGlobalOptions } from './cli-option-reader';
import type { EntityKitCliCommandName } from './cli-command-definitions';
import type { EntityKitCliOptions, EntityKitCliResult } from './cli-result';
import { runCompletionCommand } from './commands/completion-command';
import { runInitCommand } from './commands/init-command';
import { runDbMigrateCommand } from './commands/db/migrate-command';
import { runDbPullCommand } from './commands/db/pull-command';
import { runDbStatusCommand } from './commands/db/status-command';
import { runMigrationAddCommand } from './commands/migration/add-command';
import { runMigrationCheckCommand } from './commands/migration/check-command';
import { runMigrationListCommand } from './commands/migration/list-command';
import { runMigrationRemoveCommand } from './commands/migration/remove-command';
import { runMigrationScriptCommand } from './commands/migration/script-command';

type CliCommandHandler = (
    args: readonly string[],
    global: ParsedGlobalOptions,
    options: EntityKitCliOptions,
) => EntityKitCliResult | Promise<EntityKitCliResult>;

const commandHandlers = {
    completion: runCompletionCommand,
    'db migrate': runDbMigrateCommand,
    'db pull': runDbPullCommand,
    'db status': runDbStatusCommand,
    init: runInitCommand,
    'migration add': runMigrationAddCommand,
    'migration check': runMigrationCheckCommand,
    'migration list': runMigrationListCommand,
    'migration remove': runMigrationRemoveCommand,
    'migration script': runMigrationScriptCommand,
} satisfies Record<EntityKitCliCommandName, CliCommandHandler>;

/** Execute the handler whose key is compile-time checked against CLI metadata. */
export async function executeCliCommand(
    name: string,
    args: readonly string[],
    global: ParsedGlobalOptions,
    options: EntityKitCliOptions,
): Promise<EntityKitCliResult> {
    if (!isCommandName(name)) {
        throw new Error(`EntityKit CLI has no handler for '${name}'.`);
    }
    return await commandHandlers[name](args, global, options);
}

function isCommandName(name: string): name is EntityKitCliCommandName {
    return Object.hasOwn(commandHandlers, name);
}
