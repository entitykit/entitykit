import { parseCommandArguments } from '../cli-command-parser';
import { renderEntityKitCliCompletion } from '../cli-metadata';
import { CliUsageError } from '../cli-usage-error';
import { ok, type EntityKitCliResult } from '../cli-result';

/** Render completion for exactly one supported shell. */
export function runCompletionCommand(args: readonly string[]): EntityKitCliResult {
    const parsed = parseCommandArguments(args, 'completion');
    const [shell, ...unexpected] = parsed.positionals;
    if (unexpected.length > 0 || shell !== 'bash' && shell !== 'fish' && shell !== 'zsh') {
        throw new CliUsageError('completion requires exactly one shell: bash, fish, or zsh.');
    }
    return ok(renderEntityKitCliCompletion(shell), { shell });
}
