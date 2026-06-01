import type {
    EntityKitCliCommandCapabilities,
    EntityKitCliCommandDefinition,
    EntityKitCliMetadata,
    EntityKitCliOptionDefinition,
    EntityKitCliOptionKind,
} from './cli-metadata-types';

const readOnly = capabilities();
const writesFiles = capabilities({ mutatesFiles: true });
const connectsAndWritesFiles = capabilities({ requiresConnection: true, mutatesFiles: true });
const standalone = capabilities({ requiresConfig: false });
const initializesProject = capabilities({ requiresConfig: false, mutatesFiles: true });
const readsDatabase = capabilities({ requiresConnection: true });
const writesDatabaseAndFiles = capabilities({ requiresConnection: true, mutatesDatabase: true, mutatesFiles: true });

const globalOptions = [
    option('--config', 'value', 'path', 'Use an explicit EntityKit config file.'),
    option('--cwd', 'value', 'path', 'Set the directory used for config discovery.'),
    flag('--json', 'Emit one machine-readable JSON document.'),
] as const;

const commands = [
    command('init', 'init [--provider sqlite|postgres|mysql] [--force]', 'Create a minimal EntityKit project setup.', initializesProject, [
        option('--provider', 'value', 'provider', 'Choose sqlite, postgres, or mysql. SQLite is the default.'),
        flag('--force', 'Replace generated EntityKit files that already exist.'),
    ], ['entitykit init', 'entitykit init --provider postgres']),
    command('migration add', 'migration add <name>', 'Create a migration from model changes.', writesFiles, [
        flag('--empty', 'Allow a migration with no model changes.'),
        flag('--stdout', 'Print a migration stub without loading a config or writing files.'),
        repeatable('--rename-table', 'old=new', 'Record an intentional table rename.'),
        repeatable('--rename-column', 'table.old=new', 'Record an intentional column rename.'),
    ], ['entitykit migration add InitialCreate', 'entitykit migration add RenameUser --rename-table users=accounts'], [
        'Generated destructive operations are reported as warnings; database application still requires --allow-data-loss.',
    ]),
    command('migration remove', 'migration remove [--offline]', 'Remove the latest local migration.', connectsAndWritesFiles, [
        flag('--offline', 'Skip checking whether the migration was applied to a database.'),
    ], ['entitykit migration remove', 'entitykit migration remove --offline']),
    command('migration list', 'migration list', 'List local migration artifacts.', readOnly),
    command('migration check', 'migration check', 'Check whether the model differs from its snapshot.', readOnly),
    command('migration script', 'migration script [--from migration] [--to migration]', 'Generate reviewable migration SQL without applying it.', writesFiles, [
        option('--from', 'value', 'migration', 'Start after this migration; defaults to 0.'),
        option('--to', 'value', 'migration', 'Stop at this migration; defaults to latest.'),
        flag('--idempotent', 'Generate an idempotent deployment script.'),
        option('--output', 'value', 'file.sql', 'Write the script to a file.', '-o'),
    ], ['entitykit migration script --from 0 --to latest', 'entitykit migration script --idempotent -o deploy.sql']),
    command('db migrate', 'db migrate [--to migration] [--dry-run]', 'Move a live database to a migration target.', writesDatabaseAndFiles, [
        option('--to', 'value', 'migration', 'Target an id, name, latest, or 0.'),
        flag('--dry-run', 'Validate the live database and print the exact SQL plan without applying it.'),
        flag('--allow-data-loss', 'Accept reviewed destructive operations.'),
        option('--output', 'value', 'file.sql', 'Write dry-run SQL to a file.', '-o'),
    ], ['entitykit db migrate', 'entitykit db migrate --dry-run', 'entitykit db migrate --to 0']),
    command('db status', 'db status [--check]', 'Compare local migrations with a live database.', readsDatabase, [
        flag('--check', 'Exit non-zero when migrations are pending or drift is present.'),
    ], ['entitykit db status', 'entitykit db status --check']),
    command('db pull', 'db pull [--schema name] [--output directory]', 'Generate starter model code from a live database.', connectsAndWritesFiles, [
        repeatable('--schema', 'name', 'Limit introspection to a schema.'),
        option('--output', 'value', 'directory', 'Write generated files to a directory.', '-o'),
        option('--context', 'value', 'name', 'Set the generated context class name.'),
        flag('--stdout', 'Print generated files without writing them.'),
        flag('--force', 'Replace generated files that already exist.'),
    ], ['entitykit db pull', 'entitykit db pull --schema app --output src/db']),
    command('completion', 'completion <bash|fish|zsh>', 'Generate shell completion from the command model.', standalone),
] as const satisfies readonly EntityKitCliCommandDefinition[];

export type EntityKitCliCommandName = typeof commands[number]['name'];

export const entityKitCliMetadata: EntityKitCliMetadata = {
    schemaVersion: 1,
    globalOptions,
    commands,
};

export function findEntityKitCliCommandDefinition(name: string): EntityKitCliCommandDefinition | undefined {
    return commands.find(definition => definition.name === name);
}

function command<TName extends string>(
    name: TName,
    usage: string,
    description: string,
    commandCapabilities: EntityKitCliCommandCapabilities,
    options: readonly EntityKitCliOptionDefinition[] = [],
    examples: readonly string[] = [],
    notes: readonly string[] = [],
): EntityKitCliCommandDefinition & { readonly name: TName } {
    return { name, usage, description, notes, options, examples, capabilities: commandCapabilities };
}

function capabilities(overrides: Partial<EntityKitCliCommandCapabilities> = {}): EntityKitCliCommandCapabilities {
    return {
        requiresConfig: true,
        requiresConnection: false,
        mutatesFiles: false,
        mutatesDatabase: false,
        ...overrides,
    };
}

function flag(name: `--${string}`, description: string): EntityKitCliOptionDefinition {
    return option(name, 'flag', undefined, description);
}

function repeatable(name: `--${string}`, valueName: string, description: string): EntityKitCliOptionDefinition {
    return option(name, 'repeatableValue', valueName, description);
}

function option(
    name: `--${string}`,
    kind: EntityKitCliOptionKind,
    valueName: string | undefined,
    description: string,
    shortName?: `-${string}`,
): EntityKitCliOptionDefinition {
    return { name, shortName, kind, valueName, description };
}
