import { getEntityKitCliMetadata } from './cli-metadata';
import { CliUsageError } from './cli-usage-error';

/** Global options removed before command resolution. */
export interface ParsedGlobalOptions {
    readonly argv: readonly string[];
    readonly configPath?: string;
    readonly cwd?: string;
    readonly json: boolean;
    readonly help: boolean;
    readonly version: boolean;
}

/** Parse global options wherever they occur before the `--` terminator. */
export function parseGlobalOptions(argv: readonly string[]): ParsedGlobalOptions {
    const remaining: string[] = [];
    const values: Map<string, string | true> = new Map();
    const definitions = getEntityKitCliMetadata().globalOptions;
    let terminated = false;

    for (let index = 0; index < argv.length; index++) {
        const argument = argv[index];
        if (terminated) {
            remaining.push(argument);
            continue;
        }
        if (argument === '--') {
            terminated = true;
            remaining.push(argument);
            continue;
        }

        const [spelling, inlineValue] = splitInlineValue(argument);
        const definition = definitions.find(option =>
            option.name === spelling || option.shortName === spelling);
        const special = specialGlobalName(spelling);
        if (!definition && !special) {
            remaining.push(argument);
            continue;
        }

        const name = definition?.name ?? special;
        if (!name) {
            continue;
        }
        if (values.has(name)) {
            throw new CliUsageError(`Option '${name}' may only be specified once.`);
        }
        if (!definition || definition.kind === 'flag') {
            if (inlineValue !== undefined) {
                throw new CliUsageError(`Option '${name}' does not accept a value.`);
            }
            values.set(name, true);
            continue;
        }

        const value = inlineValue ?? argv[index + 1];
        if (!value || inlineValue === undefined && looksLikeOption(value)) {
            throw new CliUsageError(`${name} requires a value.`);
        }
        values.set(name, value);
        if (inlineValue === undefined) {
            index++;
        }
    }

    return {
        argv: remaining,
        configPath: stringValue(values.get('--config')),
        cwd: stringValue(values.get('--cwd')),
        json: values.has('--json'),
        help: values.has('--help'),
        version: values.has('--version'),
    };
}

function splitInlineValue(argument: string): readonly [string, string | undefined] {
    const index = argument.startsWith('--') ? argument.indexOf('=') : -1;
    return index < 0
        ? [argument, undefined]
        : [argument.slice(0, index), argument.slice(index + 1)];
}

function specialGlobalName(spelling: string): '--help' | '--version' | undefined {
    if (spelling === '--help' || spelling === '-h') {
        return '--help';
    }
    return spelling === '--version' || spelling === '-V'
        ? '--version'
        : undefined;
}

function looksLikeOption(value: string): boolean {
    return value.startsWith('--') || value === '-h' || value === '-V';
}

function stringValue(value: string | true | undefined): string | undefined {
    return typeof value === 'string' ? value : undefined;
}
