import fs from 'fs';
import path from 'path';
import { runEntityKitCli } from '../../src/cli/api';
import {
    createProject,
    createProjectWithCustomProvider,
    removeEmailFromProjectConfig,
    renameEmailColumnInProjectConfig,
} from './migration-cli-files-test-support';

describe('migration file workflow', () => {
    it('adds, lists, checks, and removes migrations', async () => {
        const cwd = createProject();

        const add = await runEntityKitCli(
            ['migration', 'add', 'Initial Create'],
            { cwd, now: new Date('2026-06-01T18:45:30Z') },
        );
        expect(add.exitCode).toBe(0);
        expect(add.stdout).toContain('Added migration');

        const files = fs.readdirSync(path.join(cwd, 'migrations'));
        const migrationFile = files.find(file => file.endsWith('_InitialCreate.ts'));
        expect(migrationFile).toBeDefined();
        expect(fs.existsSync(path.join(cwd, 'migrations', 'EntityKitModelSnapshot.ts'))).toBe(true);

        const list = await runEntityKitCli(['migration', 'list'], { cwd });
        expect(list.exitCode).toBe(0);
        expect(list.stdout).toContain('InitialCreate');

        const pending = await runEntityKitCli(
            ['migration', 'check'],
            { cwd },
        );
        expect(pending.exitCode).toBe(0);
        expect(pending.stdout).toContain('No pending model changes');

        const remove = await runEntityKitCli(['migration', 'remove', '--offline'], { cwd });
        expect(remove.exitCode).toBe(0);
        expect(remove.stdout).toContain('Removed migration');
        expect(
            fs.readdirSync(path.join(cwd, 'migrations'))
                .some(file => file.endsWith('_InitialCreate.ts')),
        ).toBe(false);
    });

    it('returns non-zero for pending model changes', async () => {
        const cwd = createProject();

        const pending = await runEntityKitCli(
            ['migration', 'check'],
            { cwd },
        );

        expect(pending.exitCode).toBe(1);
        expect(pending.stdout).toContain('Pending model changes found');
    });

    it('reports destructive authoring and enforces approval at database application', async () => {
        const cwd = createProjectWithCustomProvider();
        await runEntityKitCli(
            ['migration', 'add', 'Initial Create'],
            { cwd, now: new Date('2026-06-01T18:45:30Z') },
        );
        removeEmailFromProjectConfig(cwd);

        const added = await runEntityKitCli(
            ['migration', 'add', 'Drop Email'],
            { cwd, now: new Date('2026-06-01T19:00:00Z') },
        );

        expect(added.exitCode).toBe(0);
        expect(added.warnings).toHaveLength(1);
        expect(added.warnings[0]?.code).toBe('MIGRATION_DATA_LOSS');
        expect(added.warnings[0]?.message).toContain('Drop column users.email');
        expect(
            fs.readdirSync(path.join(cwd, 'migrations'))
                .some(file => file.endsWith('_DropEmail.ts')),
        ).toBe(true);

        const refused = await runEntityKitCli(['db', 'migrate'], { cwd });
        expect(refused).toMatchObject({
            exitCode: 1,
            error: { code: 'MIGRATION_DATA_LOSS' },
        });

        const allowed = await runEntityKitCli(['db', 'migrate', '--allow-data-loss'], { cwd });
        expect(allowed.exitCode).toBe(0);
    });

    it('uses rename hints to generate data-preserving migrations', async () => {
        const cwd = createProject();
        await runEntityKitCli(
            ['migration', 'add', 'Initial Create'],
            { cwd, now: new Date('2026-06-01T18:45:30Z') },
        );
        renameEmailColumnInProjectConfig(cwd);

        const result = await runEntityKitCli([
            'migration',
            'add',
            'Rename Email',
            '--rename-column',
            'app.users.email=contact_email',
        ], { cwd, now: new Date('2026-06-01T19:00:00Z') });

        expect(result.exitCode).toBe(0);
        expect(result.stdout).not.toContain('Warnings:');
        const migration = fs.readFileSync(
            path.join(cwd, 'migrations', '20260601190000_RenameEmail.ts'),
            'utf8',
        );
        expect(migration).toContain(
            'builder.renameColumn("users", "email", "contact_email", "app");',
        );
        expect(migration).not.toContain('dropColumn');
    });

    it('generates migration scripts and writes output files', async () => {
        const cwd = createProject();
        await runEntityKitCli(
            ['migration', 'add', 'Initial Create'],
            { cwd, now: new Date('2026-06-01T18:45:30Z') },
        );

        const script = await runEntityKitCli(
            ['migration', 'script', '--idempotent'],
            { cwd },
        );
        expect(script.exitCode).toBe(0);
        expect(script.stdout).toContain('__entitykit_migrations');
        expect(script.stdout).toContain('if not exists');

        const output = await runEntityKitCli(
            ['migration', 'script', '--output', 'deploy.sql'],
            { cwd },
        );
        expect(output.exitCode).toBe(0);
        expect(fs.readFileSync(path.join(cwd, 'deploy.sql'), 'utf8')).toContain('create table');
    });

    it('returns non-zero for invalid migration ranges', async () => {
        const cwd = createProject();
        await runEntityKitCli(
            ['migration', 'add', 'Initial Create'],
            { cwd, now: new Date('2026-06-01T18:45:30Z') },
        );

        const result = await runEntityKitCli(
            ['migration', 'script', '--from', 'MissingMigration'],
            { cwd },
        );

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('Unknown from migration \'MissingMigration\'');
    });

    it('returns non-zero when explicit config loading fails', async () => {
        const cwd = createProject();

        const result = await runEntityKitCli(
            ['--config', 'missing.config.ts', 'migration', 'list'],
            { cwd },
        );

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('no such file or directory');
        expect(result.stderr).toContain('missing.config.ts');
    });

    it('creates empty migrations when requested', async () => {
        const cwd = createProject();
        await runEntityKitCli(
            ['migration', 'add', 'Initial Create'],
            { cwd, now: new Date('2026-06-01T18:45:30Z') },
        );

        const add = await runEntityKitCli(
            ['migration', 'add', 'Manual Sql', '--empty'],
            { cwd, now: new Date('2026-06-01T19:00:00Z') },
        );

        expect(add.exitCode).toBe(0);
        const migration = fs.readFileSync(
            path.join(cwd, 'migrations', '20260601190000_ManualSql.ts'),
            'utf8',
        );
        expect(migration).toContain('No operations.');
    });

    it('keeps migration ids increasing when two are added in the same second', async () => {
        const cwd = createProject();
        const sameSecond = new Date('2026-06-01T18:45:30Z');
        await runEntityKitCli(
            ['migration', 'add', 'Initial Create'],
            { cwd, now: sameSecond },
        );
        const migrationPath = path.join(
            cwd,
            'migrations',
            '20260601184530_InitialCreate.ts',
        );
        const originalMigration = fs.readFileSync(migrationPath, 'utf8');

        // Timestamps have second resolution. Sharing a prefix would leave ordering
        // to the migration *name*, which can place a later migration before an
        // earlier one — so the second id advances instead.
        const second = await runEntityKitCli(
            ['migration', 'add', 'Add Profile', '--empty'],
            { cwd, now: sameSecond },
        );

        expect(second.stderr).toBe('');
        expect(second.exitCode).toBe(0);
        expect(second.stdout).toContain('20260601184531_AddProfile');
        // The first migration is untouched, so nothing can be overwritten.
        expect(fs.readFileSync(migrationPath, 'utf8')).toBe(originalMigration);

        const ids = fs.readdirSync(path.join(cwd, 'migrations'))
            .filter(file => /^\d{14}_/.test(file))
            .sort();
        expect(ids).toEqual([
            '20260601184530_InitialCreate.ts',
            '20260601184531_AddProfile.ts',
        ]);
    });
});
