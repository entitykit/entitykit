import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runEntityKitCli, type EntityKitCliResult } from '../src/cli/entity-kit-cli';
import { createManagedTempDirectory } from './support/managed-temp-directory';

describe('CLI failure surface', () => {
    let directory = '';

    beforeEach(() => {
        directory = createManagedTempDirectory('entitykit-cli-failure-');
    });

    const run = async (argv: string[], cwd = directory): Promise<EntityKitCliResult> =>
        runEntityKitCli(argv, { cwd });

    it('does not report success when required work could not start', async () => {
        const migrate = await run(['db', 'migrate']);
        const add = await run(['migration', 'add']);

        expect(migrate).toMatchObject({ exitCode: 1, outcome: 'error' });
        expect(migrate.stderr).toContain('Could not find an EntityKit config file');
        expect(add).toMatchObject({ exitCode: 2, outcome: 'error' });
        expect(add.stderr).toContain('migration add requires a name');
    });

    it('distinguishes explicitly requested help from invalid usage', async () => {
        const help = await run(['migration', 'add', '--help']);
        const missingValue = await run(['migration', 'script', '--output']);

        expect(help).toMatchObject({ exitCode: 0, outcome: 'success' });
        expect(help.stdout).toContain('Usage:');
        expect(missingValue).toMatchObject({ exitCode: 2, outcome: 'error' });
        expect(missingValue.stderr).toContain('--output requires a value');
    });

    it('refuses a misspelled dry-run instead of applying', async () => {
        const result = await run(['db', 'migrate', '--dry-runn']);

        expect(result).toMatchObject({ exitCode: 2, outcome: 'error' });
        expect(result.stderr).toContain('Unknown option \'--dry-runn\' for \'db migrate\'');
        expect(result.stderr).toContain('Did you mean \'--dry-run\'?');
    });

    it('refuses an output path unless database migration is a dry-run', async () => {
        const result = await run(['db', 'migrate', '--output', 'plan.sql']);

        expect(result).toMatchObject({ exitCode: 2, outcome: 'error' });
        expect(result.stderr).toContain('--output requires --dry-run');
    });

    it('names unknown command paths and suggests the nearest command', async () => {
        const root = await run(['migraton']);
        const leaf = await run(['db', 'statuz']);

        expect(root.stderr).toContain('Did you mean \'migration\'?');
        expect(leaf.stderr).toContain('Did you mean \'db status\'?');
    });

    it.each(['list', 'check'])('classifies migration %s positionals as usage errors', async command => {
        const result = await run(['migration', command, 'unexpected']);

        expect(result).toMatchObject({ exitCode: 2, outcome: 'error' });
        expect(result.stderr).toContain('does not accept positional arguments');
    });

    it('names malformed configuration files without masking their error', async () => {
        const caseDirectory = join(directory, 'broken');
        mkdirSync(caseDirectory);
        writeFileSync(
            join(caseDirectory, 'entitykit.config.js'),
            'module.exports = { this is not valid',
        );

        const result = await run(['migration', 'list'], caseDirectory);

        expect(result).toMatchObject({ exitCode: 1, outcome: 'error' });
        expect(result.stderr).toContain('Unexpected identifier \'is\'');
    });
});
