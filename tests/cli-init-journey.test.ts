import fs from 'node:fs';
import path from 'node:path';
import { runEntityKitCli } from '../packages/cli/src/api';
import { SqliteDatabaseConnection } from '../packages/sqlite/src';
import { migrationHistoryTableName } from '../packages/core/src/migrations/migration-metadata';
import { createManagedTempDirectory } from './support/managed-temp-directory';
import { requireDefined } from './support/require-defined';

/**
 * The getting-started journey exactly as `entitykit init` advertises it.
 *
 * The existing init tests only assert the *files* init writes, so nothing ever
 * ran the commands init prints. That is how init shipped guidance whose very
 * next step failed: the generated context carries no entity, so
 * `migration add` found no model changes and refused. This test parses the
 * printed steps out of stdout and performs them in order against a real SQLite
 * database, so the advertised sequence cannot drift from the one that works.
 */
describe('entitykit init journey', () => {
    it('runs the workflow that init prints, end to end, against SQLite', async () => {
        const cwd = createProject('entitykit-init-journey-');

        const init = await runEntityKitCli(['init'], { cwd });
        expect(init.exitCode).toBe(0);

        const [modelStep, ...commandSteps] = advertisedSteps(init.stdout);
        // Step one is manual: it names the file the developer edits.
        const contextFile = requireDefined(
            /\bto (\S+)$/u.exec(requireDefined(modelStep, 'model step'))?.[1],
            'context file in the model step',
        );
        const contextPath = path.join(cwd, contextFile);
        expect(fs.existsSync(contextPath)).toBe(true);
        addEntityAndMapping(contextPath);

        expect(commandSteps).toEqual([
            'entitykit migration add InitialCreate',
            'entitykit db migrate',
        ]);
        for (const step of commandSteps) {
            const argv = step.split(' ');
            expect(argv[0]).toBe('entitykit');
            const run = await runEntityKitCli(argv.slice(1), {
                cwd,
                now: new Date('2026-06-01T18:45:30Z'),
            });
            expect({ step, exitCode: run.exitCode, stderr: run.stderr })
                .toEqual({ step, exitCode: 0, stderr: '' });
        }

        const migrationsDir = path.join(cwd, 'src', 'db', 'migrations');
        expect(fs.readdirSync(migrationsDir)).toEqual(expect.arrayContaining([
            '20260601184530_InitialCreate.ts',
            'EntityKitModelSnapshot.ts',
        ]));
        await expectMigratedDatabase(path.join(cwd, 'entitykit.db'));

        const status = await runEntityKitCli(['db', 'status', '--check'], { cwd });
        expect(status.exitCode).toBe(0);
    });

    it('needs the model step first, which is why init prints it', async () => {
        const cwd = createProject('entitykit-init-journey-empty-');
        await runEntityKitCli(['init'], { cwd });

        // Skipping the advertised model step reproduces the dead end the
        // guidance exists to prevent.
        const added = await runEntityKitCli(
            ['migration', 'add', 'InitialCreate'],
            { cwd, now: new Date('2026-06-01T18:45:30Z') },
        );

        expect(added.exitCode).toBe(1);
        expect(added.stderr).toContain('No model changes were detected.');
    });
});

function createProject(prefix: string): string {
    const cwd = createManagedTempDirectory(prefix);
    fs.writeFileSync(
        path.join(cwd, 'package.json'),
        `${JSON.stringify({ name: 'app', private: true }, null, 2)}\n`,
    );
    return cwd;
}

function advertisedSteps(stdout: string): string[] {
    return stdout
        .split('\n')
        .filter(line => /^(?:Next|Then): /u.test(line))
        .map(line => line.replace(/^(?:Next|Then): /u, ''));
}

/** Do what the printed model step asks, by editing the generated context. */
function addEntityAndMapping(contextPath: string): void {
    const source = fs.readFileSync(contextPath, 'utf8');
    const edited = source
        .replace(
            'import { DbContext, type DbContextOptionsBuilder } from "entitykit";',
            'import { DbContext, type DbContextOptionsBuilder, type ModelBuilder } from "entitykit";',
        )
        .replace('export class AppDbContext extends DbContext {', [
            'export class Todo {',
            '  id = "";',
            '  title = "";',
            '}',
            '',
            'export class AppDbContext extends DbContext {',
            '  readonly todos = this.set(Todo);',
            '',
            '  protected override model(model: ModelBuilder): void {',
            '    model.entity(Todo, entity => {',
            '      entity.toTable("todos");',
            '      entity.hasKey(todo => todo.id);',
            '      entity.property(todo => todo.id).hasColumnType("text").isRequired();',
            '      entity.property(todo => todo.title).hasColumnType("text").isRequired();',
            '    });',
            '  }',
        ].join('\n'));

    // A silent no-op edit would make the rest of the journey meaningless.
    expect(edited).toContain('type ModelBuilder');
    expect(edited).toContain('model.entity(Todo');
    fs.writeFileSync(contextPath, edited);
}

async function expectMigratedDatabase(databasePath: string): Promise<void> {
    const connection = new SqliteDatabaseConnection(databasePath);
    try {
        const tables = await connection.query({
            text: 'select "name" from "sqlite_master" where "type" = \'table\' and "name" = ?',
            values: ['todos'],
        });
        expect(tables.rows).toHaveLength(1);

        const applied = await connection.query({
            text: `select "id" from "${migrationHistoryTableName}" order by "id"`,
            values: [],
        });
        expect(applied.rows).toEqual([{ id: '20260601184530_InitialCreate' }]);
    } finally {
        await connection.dispose();
    }
}
