import {
    findEntityKitCliCommand,
    findEntityKitCliOption,
    getEntityKitCliMetadata,
    type EntityKitCliCommandDefinition,
    type EntityKitCliOptionDefinition,
} from './cli-metadata';
import { closestCliSpelling } from './cli-suggestions';
import { CliUsageError } from './cli-usage-error';

/** Parsed positionals and canonical option values for one leaf command. */
export class ParsedCliArguments {
    constructor(
        public readonly positionals: readonly string[],
        private readonly options: ReadonlyMap<string, ReadonlyArray<string | true>>,
    ) {}

    public has(option: `--${string}`): boolean {
        return this.options.has(option);
    }

    public value(option: `--${string}`): string | undefined {
        return this.values(option)[0];
    }

    public values(option: `--${string}`): readonly string[] {
        return (this.options.get(option) ?? [])
            .filter((value): value is string => typeof value === 'string');
    }
}

/** Parse one leaf command from its canonical option definition. */
export function parseCommandArguments(
    args: readonly string[],
    command: string,
): ParsedCliArguments {
    const definition = findEntityKitCliCommand(command);
    if (!definition) {
        throw new Error(`EntityKit CLI metadata is missing '${command}'.`);
    }

    const positionals: string[] = [];
    const values: Map<string, Array<string | true>> = new Map();
    let terminated = false;
    for (let index = 0; index < args.length; index++) {
        const argument = args[index];
        if (terminated) {
            positionals.push(argument);
            continue;
        }
        if (argument === '--') {
            terminated = true;
            continue;
        }
        if (!argument.startsWith('-') || argument === '-') {
            positionals.push(argument);
            continue;
        }

        const [spelling, inlineValue] = splitInlineValue(argument);
        const option = findEntityKitCliOption(definition, spelling);
        if (!option) {
            throw unknownOption(command, spelling, definition);
        }
        const existing = values.get(option.name);
        if (existing && option.kind !== 'repeatableValue') {
            throw new CliUsageError(`Option '${option.name}' may only be specified once.`);
        }
        if (option.kind === 'flag') {
            if (inlineValue !== undefined) {
                throw new CliUsageError(`Option '${option.name}' does not accept a value.`);
            }
            values.set(option.name, [true]);
            continue;
        }

        const value = inlineValue ?? args[index + 1];
        if (!value || inlineValue === undefined && value.startsWith('--')) {
            throw new CliUsageError(`${option.name} requires a value.`);
        }
        values.set(option.name, [...existing ?? [], value]);
        if (inlineValue === undefined) {
            index++;
        }
    }

    return new ParsedCliArguments(positionals, values);
}

function unknownOption(
    command: string,
    spelling: string,
    definition: EntityKitCliCommandDefinition,
): CliUsageError {
    const options = [
        ...definition.options,
        ...getEntityKitCliMetadata().globalOptions,
    ].flatMap(optionSpellings);
    const known = [...options, '--help', '-h'];
    const suggestion = closestCliSpelling(spelling, known);
    return new CliUsageError(
        `Unknown option '${spelling}' for '${command}'.` +
        (suggestion ? ` Did you mean '${suggestion}'?` : '') +
        `\nKnown options: ${known.sort().join(', ')}.`,
    );
}

function optionSpellings(option: EntityKitCliOptionDefinition): string[] {
    return option.shortName ? [option.name, option.shortName] : [option.name];
}

function splitInlineValue(argument: string): readonly [string, string | undefined] {
    const index = argument.startsWith('--') ? argument.indexOf('=') : -1;
    return index < 0
        ? [argument, undefined]
        : [argument.slice(0, index), argument.slice(index + 1)];
}
