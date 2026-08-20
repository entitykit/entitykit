import { spawnSync } from 'node:child_process';
import {
    type EntityKitCliCommandCapabilities,
    getEntityKitCliCommandSchema,
    getEntityKitCliMetadata,
    renderEntityKitCliCompletion,
    runEntityKitCli,
} from '../packages/cli/src/api';

describe('EntityKit CLI', () => {
    it('presents one small, coherent command language', async () => {
        const result = await runEntityKitCli(['--help']);

        expect(result).toMatchObject({ exitCode: 0, outcome: 'success' });
        expect(result.stdout).toContain('EntityKit CLI');
        expect(result.stdout).toContain('migration    Create and inspect migration artifacts.');
        expect(result.stdout).toContain('db           Inspect and update a live database.');
        expect(result.stdout).toContain('--json');
        expect(result.stdout).not.toContain('database update');
        expect(result.stdout).not.toContain('migrations add');
    });

    it('reports the installed package version', async () => {
        const result = await runEntityKitCli(['--version']);

        expect(result).toMatchObject({
            exitCode: 0,
            command: 'version',
            data: { version: '0.1.0-alpha.1' },
        });
        expect(result.stdout).toBe('0.1.0-alpha.1');
    });

    it('returns exactly one versioned JSON envelope', async () => {
        const result = await runEntityKitCli(['migration', '--help', '--json']);
        const payload = JSON.parse(result.stdout) as Record<string, unknown>;

        expect(result.stderr).toBe('');
        expect(payload).toMatchObject({
            schemaVersion: 1,
            command: 'migration',
            outcome: 'success',
            warnings: [],
            error: null,
            exitCode: 0,
        });
        expect(payload).not.toHaveProperty('stdout');
        expect(payload).not.toHaveProperty('stderr');
    });

    it('keeps usage failures machine-readable and distinct', async () => {
        const result = await runEntityKitCli(['db', 'migrate', '--config', '--dry-run', '--json']);
        const payload = JSON.parse(result.stdout) as Record<string, unknown>;

        expect(result).toMatchObject({ exitCode: 2, stderr: '' });
        expect(payload).toMatchObject({
            command: 'db.migrate',
            outcome: 'error',
            error: { code: 'CLI_USAGE', message: '--config requires a value.' },
            exitCode: 2,
        });
    });

    it('drives help, schema, capabilities, and completion from one model', async () => {
        const metadata = getEntityKitCliMetadata();
        const migrate = metadata.commands.find(command => command.name === 'db migrate');
        const schema = JSON.stringify(getEntityKitCliCommandSchema());
        const help = await runEntityKitCli(['db', 'migrate', '--help']);
        const bash = renderEntityKitCliCompletion('bash');

        expect(migrate).toMatchObject({
            capabilities: {
                requiresConfig: true,
                requiresConnection: true,
                mutatesDatabase: true,
                mutatesFiles: true,
            },
        });
        expect(migrate?.options.map(option => option.name)).toContain('--allow-data-loss');
        expect(help.stdout).toContain('--allow-data-loss');
        expect(schema).toContain('--allow-data-loss');
        expect(bash).toContain('--allow-data-loss');
    });

    it('conservatively declares every command side effect', () => {
        const commands = getEntityKitCliMetadata().commands;
        const capability = (name: string): EntityKitCliCommandCapabilities | undefined =>
            commands.find(command => command.name === name)?.capabilities;

        expect(capability('migration script')).toMatchObject({ mutatesFiles: true });
        expect(capability('migration remove')).toMatchObject({ requiresConnection: true, mutatesFiles: true });
        expect(capability('db pull')).toMatchObject({ requiresConnection: true, mutatesFiles: true });
        expect(capability('db migrate')).toMatchObject({
            requiresConnection: true,
            mutatesDatabase: true,
            mutatesFiles: true,
        });
    });

    it.each(['bash', 'fish', 'zsh'] as const)('renders %s completion', async shell => {
        const result = await runEntityKitCli(['completion', shell]);

        expect(result).toMatchObject({ exitCode: 0, data: { shell } });
        expect(result.stdout).toContain('entitykit');
    });

    it('scopes Bash completion to the active command and known values', () => {
        const bash = renderEntityKitCliCompletion('bash');
        const migrate = completeBash(bash, ['entitykit', 'db', 'migrate', '--']);
        const providers = completeBash(bash, ['entitykit', 'init', '--provider', '']);

        expect(migrate).toContain('--dry-run');
        expect(migrate).toContain('--allow-data-loss');
        expect(migrate).not.toContain('--check');
        expect(migrate).not.toContain('--schema');
        expect(providers).toEqual(['sqlite', 'postgres', 'mysql']);
    });

    it('prints a migration stub without loading configuration', async () => {
        const result = await runEntityKitCli([
            'migration', 'add', 'Create Users', '--stdout',
        ]);

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('export class CreateUsers extends Migration');
        expect(result.stdout).toContain('readonly id = "YYYYMMDDHHMMSS_CreateUsers"');
    });

    it('deletes the unreleased legacy grammar instead of carrying aliases', async () => {
        const plural = await runEntityKitCli(['migrations', 'list']);
        const database = await runEntityKitCli(['database', 'update']);

        expect(plural).toMatchObject({ exitCode: 2, outcome: 'error' });
        expect(database).toMatchObject({ exitCode: 2, outcome: 'error' });
        expect(plural.stderr).toContain('Did you mean \'migration\'?');
    });

});

function completeBash(script: string, words: readonly string[]): string[] {
    const invocation = [
        script,
        `COMP_WORDS=(${words.map(word => JSON.stringify(word)).join(' ')})`,
        `COMP_CWORD=${String(words.length - 1)}`,
        '_entitykit_complete',
        'printf \'%s\\n\' "${COMPREPLY[@]}"',
    ].join('\n');
    const result = spawnSync('bash', ['-c', invocation], { encoding: 'utf8' });
    if (result.status !== 0) {
        throw new Error(`Bash completion failed: ${result.stderr}`);
    }
    return result.stdout.trim().split('\n').filter(Boolean);
}
