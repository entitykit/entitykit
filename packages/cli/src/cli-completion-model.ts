import { entityKitCliMetadata } from './cli-command-definitions';
import type {
    EntityKitCliCommandDefinition,
    EntityKitCliOptionDefinition,
} from './cli-metadata-types';

const fixedValues: Readonly<Partial<Record<string, readonly string[]>>> = {
    '--provider': ['sqlite', 'postgres', 'mysql'],
    '--from': ['0', 'latest'],
    '--to': ['0', 'latest'],
};

export function commandCompletionWords(command: EntityKitCliCommandDefinition): string[] {
    return unique([...command.options.flatMap(optionSpellings), ...globalWords(), '--help', '-h']);
}

export function rootCompletionWords(): string[] {
    return unique([...rootCommands(), ...globalWords(), '--help', '-h', '--version', '-V']);
}

export function rootCommands(): string[] {
    return unique(entityKitCliMetadata.commands.map(command => command.name.split(' ')[0]));
}

export function groupCompletionWords(group: string): string[] {
    return entityKitCliMetadata.commands
        .filter(command => command.name.startsWith(`${group} `))
        .map(command => command.name.slice(group.length + 1));
}

export function globalOptions(): readonly EntityKitCliOptionDefinition[] {
    return entityKitCliMetadata.globalOptions;
}

export function fixedCompletionValues(option: string): readonly string[] | undefined {
    return fixedValues[option];
}

export function fixedValueEntries(): Array<[string, readonly string[]]> {
    return Object.entries(fixedValues)
        .filter((entry): entry is [string, readonly string[]] => entry[1] !== undefined);
}

export function freeValueSpellings(): string[] {
    return unique([...globalOptions(), ...entityKitCliMetadata.commands.flatMap(command => command.options)])
        .filter(option => option.kind !== 'flag' && !fixedValues[option.name])
        .flatMap(optionSpellings)
        .filter(spelling => !['--config', '--cwd', '--output', '-o'].includes(spelling));
}

function globalWords(): string[] {
    return globalOptions().flatMap(optionSpellings);
}

function optionSpellings(option: EntityKitCliOptionDefinition): string[] {
    return option.shortName ? [option.name, option.shortName] : [option.name];
}

function unique<TValue>(values: readonly TValue[]): TValue[] {
    return Array.from(new Set(values));
}
