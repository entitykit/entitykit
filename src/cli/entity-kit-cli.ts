import { isEntityKitError } from '../errors/entity-kit-error';
import { DatabaseProviderError } from '../storage/database-provider-error';
import { executeCliCommand } from './cli-command-handlers';
import { resolveCliCommand } from './cli-command-resolution';
import { renderCommandHelp, renderGroupHelp, renderRootHelp } from './cli-help';
import { parseGlobalOptions } from './cli-option-reader';
import { CliUsageError } from './cli-usage-error';
import { formatCliError } from './output/error-output';
import { entityKitPackageVersion } from './package-version';
import {
    fail,
    finalizeCliResult,
    ok,
    type EntityKitCliOptions,
    type EntityKitCliResult,
} from './cli-result';

export type { EntityKitCliOptions, EntityKitCliResult } from './cli-result';

/** Parse, resolve, execute, and present one EntityKit CLI invocation. */
export async function runEntityKitCli(
    argv: readonly string[],
    options: EntityKitCliOptions = {},
): Promise<EntityKitCliResult> {
    let command = inferCommandName(argv);
    let json = argv.includes('--json');
    try {
        const global = parseGlobalOptions(argv);
        json = global.json;
        const resolved = resolveCliCommand(global.argv);
        command = resolved.kind === 'root' ? 'help' : resolved.name.replace(' ', '.');

        if (global.version) {
            return finalizeCliResult(ok(entityKitPackageVersion(), {
                version: entityKitPackageVersion(),
            }), 'version', json);
        }
        if (resolved.kind === 'root') {
            return finalizeCliResult(ok(renderRootHelp()), 'help', json);
        }
        if (resolved.kind === 'group') {
            return finalizeCliResult(ok(renderGroupHelp(resolved.name)), resolved.name, json);
        }
        if (global.help) {
            return finalizeCliResult(ok(renderCommandHelp(resolved.name)), command, json);
        }

        const result = await executeCliCommand(resolved.name, resolved.args, global, options);
        return finalizeCliResult(result, command, json);
    } catch (error) {
        const entityKitError = isEntityKitError(error) ? error : undefined;
        const providerError = error instanceof DatabaseProviderError ? error : undefined;
        return finalizeCliResult(
            fail(
                formatCliError(error),
                error instanceof CliUsageError
                    ? 'CLI_USAGE'
                    : entityKitError?.code ?? 'CLI_ERROR',
                providerError?.toJSON() ?? entityKitError?.toJSON().details,
            ),
            command,
            json,
        );
    }
}

function inferCommandName(argv: readonly string[]): string {
    const positionals = argv.filter((argument, index) =>
        !argument.startsWith('-') && !isGlobalValue(argv[index - 1]));
    return positionals.slice(0, 2).join('.') || 'help';
}

function isGlobalValue(previous: string | undefined): boolean {
    return previous === '--config' || previous === '--cwd';
}
