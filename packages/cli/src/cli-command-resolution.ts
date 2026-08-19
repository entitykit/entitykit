import { findEntityKitCliCommand, getEntityKitCliMetadata } from './cli-metadata';
import { closestCliSpelling } from './cli-suggestions';
import { CliUsageError } from './cli-usage-error';

/** A resolved leaf command or a command group that should render help. */
export type ResolvedCliCommand =
    | { readonly kind: 'command'; readonly name: string; readonly args: readonly string[] }
    | { readonly kind: 'group'; readonly name: 'db' | 'migration' }
    | { readonly kind: 'root' };

/** Resolve the command path before parsing command-specific options. */
export function resolveCliCommand(argv: readonly string[]): ResolvedCliCommand {
    const [root, subcommand, ...rest] = argv;
    if (!root) {
        return { kind: 'root' };
    }
    if (root === 'db' || root === 'migration') {
        if (!subcommand || subcommand === '--') {
            return { kind: 'group', name: root };
        }
        const name = `${root} ${subcommand}`;
        if (!findEntityKitCliCommand(name)) {
            throw unknownCommand(name, commandsInGroup(root));
        }
        return { kind: 'command', name, args: rest };
    }
    if (!findEntityKitCliCommand(root)) {
        throw unknownCommand(root, rootCommands());
    }
    return { kind: 'command', name: root, args: [subcommand, ...rest].filter(isDefined) };
}

function unknownCommand(typed: string, known: readonly string[]): CliUsageError {
    const suggestion = closestCliSpelling(typed, known);
    return new CliUsageError(
        `Unknown command '${typed}'.${suggestion ? ` Did you mean '${suggestion}'?` : ''}`,
    );
}

function commandsInGroup(group: string): string[] {
    return getEntityKitCliMetadata().commands
        .filter(command => command.name.startsWith(`${group} `))
        .map(command => command.name);
}

function rootCommands(): string[] {
    return Array.from(new Set(getEntityKitCliMetadata().commands
        .map(command => command.name.split(' ')[0])));
}

function isDefined(value: string | undefined): value is string {
    return value !== undefined;
}
