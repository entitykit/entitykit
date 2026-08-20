import { parseCommandArguments } from '../packages/cli/src/cli-command-parser';
import { parseGlobalOptions } from '../packages/cli/src/cli-option-reader';

describe('CLI argument parsing', () => {
    it('derives flags, values, repeats, and positionals from command metadata', () => {
        const parsed = parseCommandArguments([
            'target', '--schema=app', '--stdout', '--schema', 'audit',
        ], 'db pull');

        expect(parsed.positionals).toEqual(['target']);
        expect(parsed.has('--stdout')).toBe(true);
        expect(parsed.values('--schema')).toEqual(['app', 'audit']);
    });

    it('accepts long equals syntax and declared short options', () => {
        const parsed = parseCommandArguments([
            '--from=0', '--to', 'latest', '-o', '-migration.sql',
        ], 'migration script');

        expect(parsed.value('--from')).toBe('0');
        expect(parsed.value('--to')).toBe('latest');
        expect(parsed.value('--output')).toBe('-migration.sql');
    });

    it('rejects duplicate singular options but retains declared repeats', () => {
        expect(() => parseCommandArguments([
            '--output', 'first.sql', '--output', 'second.sql',
        ], 'migration script')).toThrow('Option \'--output\' may only be specified once.');

        expect(parseCommandArguments([
            '--schema', 'app', '--schema', 'audit',
        ], 'db pull').values('--schema')).toEqual(['app', 'audit']);
    });

    it('removes interspersed globals while preserving command arguments', () => {
        expect(parseGlobalOptions([
            'db', '--config=entitykit.custom.ts', 'migrate',
            '--cwd', 'packages/app', '--json', '--dry-run',
        ])).toEqual({
            argv: ['db', 'migrate', '--dry-run'],
            configPath: 'entitykit.custom.ts',
            cwd: 'packages/app',
            json: true,
            help: false,
            version: false,
        });
    });

    it.each(['--config', '--cwd'] as const)(
        'does not consume a command option as the value for %s',
        option => {
            expect(() => parseGlobalOptions([
                'db', 'migrate', option, '--dry-run',
            ])).toThrow(`${option} requires a value.`);
        },
    );

    it('honors the option terminator', () => {
        const parsed = parseCommandArguments([
            '--stdout', '--', '--schema', '-thing',
        ], 'db pull');

        expect(parsed.has('--stdout')).toBe(true);
        expect(parsed.positionals).toEqual(['--schema', '-thing']);
    });

    it('suggests misspelled safety options', () => {
        expect(() => parseCommandArguments([
            '--allow-data-los',
        ], 'db migrate')).toThrow('Did you mean \'--allow-data-loss\'?');
    });
});
