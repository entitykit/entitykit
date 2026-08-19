import {
    findEntityKitCliCommand,
    getEntityKitCliMetadata,
    type EntityKitCliOptionDefinition,
} from './cli-metadata';

/** Render concise top-level help. */
export function renderRootHelp(): string {
    const metadata = getEntityKitCliMetadata();
    return [
        'EntityKit CLI',
        '',
        'Usage:',
        '  entitykit [global options] <command>',
        '',
        'Commands:',
        ...rootEntries(),
        '',
        'Global options:',
        ...metadata.globalOptions.map(renderOption),
        '  -h, --help       Show help.',
        '  -V, --version    Show the installed EntityKit version.',
        '',
        'Run \'entitykit <command> --help\' for command-specific guidance.',
    ].join('\n');
}

/** Render help for a command group such as `migration` or `db`. */
export function renderGroupHelp(group: string): string {
    const commands = getEntityKitCliMetadata().commands
        .filter(command => command.name.startsWith(`${group} `));
    return [
        'Usage:',
        `  entitykit ${group} <command>`,
        '',
        'Commands:',
        ...commands.map(command => `  ${command.name.slice(group.length + 1).padEnd(12)} ${command.description}`),
    ].join('\n');
}

/** Render detailed help from one canonical command definition. */
export function renderCommandHelp(name: string): string {
    const definition = findEntityKitCliCommand(name);
    if (!definition) {
        throw new Error(`EntityKit CLI metadata is missing '${name}'.`);
    }
    return [
        'Usage:',
        `  entitykit ${definition.usage}`,
        '',
        definition.description,
        ...definition.notes,
        ...definition.options.length > 0
            ? ['', 'Options:', ...definition.options.map(renderOption)]
            : [],
        ...definition.examples.length > 0
            ? ['', 'Examples:', ...definition.examples.map(example => `  ${example}`)]
            : [],
    ].join('\n');
}

function rootEntries(): string[] {
    const metadata = getEntityKitCliMetadata();
    const groups = new Set(metadata.commands
        .filter(command => command.name.includes(' '))
        .map(command => command.name.split(' ')[0]));
    const leaves = metadata.commands.filter(command => !command.name.includes(' '));
    return [
        ...leaves.map(command => `  ${command.name.padEnd(12)} ${command.description}`),
        ...[...groups].map(group => `  ${group.padEnd(12)} ${groupDescription(group)}`),
    ];
}

function groupDescription(group: string): string {
    return group === 'migration'
        ? 'Create and inspect migration artifacts.'
        : 'Inspect and update a live database.';
}

function renderOption(option: EntityKitCliOptionDefinition): string {
    const spelling = [option.shortName, option.name].filter(Boolean).join(', ');
    const label = `${spelling}${option.valueName ? ` <${option.valueName}>` : ''}`;
    return `  ${label.padEnd(24)} ${option.description}`;
}
