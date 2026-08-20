import fs from 'node:fs';
import path from 'node:path';
import { runEntityKitCli } from '../../packages/cli/src/api';
import {
    createProject,
    createProjectWithCustomProvider,
    createProjectWithThrowingProvider,
} from './migration-cli-files-test-support';

describe('db migrate', () => {
    it('dry-runs from the live database state instead of migration zero', async () => {
        const cwd = createProjectWithCustomProvider(['20260601184530_InitialCreate']);
        await runEntityKitCli(
            ['migration', 'add', 'Initial Create'],
            { cwd, now: new Date('2026-06-01T18:45:30Z') },
        );
        await runEntityKitCli(
            ['migration', 'add', 'Add Manual Step', '--empty'],
            { cwd, now: new Date('2026-06-01T19:00:00Z') },
        );

        const dryRun = await runEntityKitCli(['db', 'migrate', '--dry-run'], { cwd });

        expect(dryRun).toMatchObject({
            exitCode: 0,
            outcome: 'success',
            data: {
                from: '20260601184530_InitialCreate',
                target: 'Latest',
                steps: ['up:20260601190000_AddManualStep'],
            },
        });
        expect(dryRun.stdout).not.toContain('20260601184530_InitialCreate');
        expect(dryRun.stdout).toContain('20260601190000_AddManualStep');
    });

    it('connects for a dry-run so connection failures are not hidden', async () => {
        const cwd = createProjectWithThrowingProvider();
        await runEntityKitCli(
            ['migration', 'add', 'Initial Create'],
            { cwd, now: new Date('2026-06-01T18:45:30Z') },
        );

        const dryRun = await runEntityKitCli(['db', 'migrate', '--dry-run'], { cwd });

        expect(dryRun).toMatchObject({ exitCode: 1, outcome: 'error' });
        expect(dryRun.stderr).toContain('Failed to create database connection for provider \'throwing-provider\'');
    });

    it('requires an explicit connection for live migration operations', async () => {
        const cwd = createProject();
        await runEntityKitCli(
            ['migration', 'add', 'Initial Create'],
            { cwd, now: new Date('2026-06-01T18:45:30Z') },
        );

        const update = await runEntityKitCli(['db', 'migrate'], { cwd });

        expect(update).toMatchObject({ exitCode: 1, outcome: 'error' });
        expect(update.stderr).toContain('db migrate requires connection');
    });

    it('uses configured provider services for migration execution', async () => {
        const cwd = createProjectWithCustomProvider();
        await runEntityKitCli(
            ['migration', 'add', 'Initial Create'],
            { cwd, now: new Date('2026-06-01T18:45:30Z') },
        );

        const update = await runEntityKitCli(['db', 'migrate'], { cwd });

        expect(update).toMatchObject({ exitCode: 0, outcome: 'success' });
        expect(update.stdout).toContain('Applied 1 migration step(s).');
        expect(update.stdout).toContain('Migration lock: not configured');
    });

    it('writes dry-run SQL without replacing an existing review artifact', async () => {
        const cwd = createProjectWithCustomProvider();
        await runEntityKitCli(
            ['migration', 'add', 'Initial Create'],
            { cwd, now: new Date('2026-06-01T18:45:30Z') },
        );

        const written = await runEntityKitCli([
            'db', 'migrate', '--dry-run', '--output', 'plan.sql',
        ], { cwd });
        const refused = await runEntityKitCli([
            'db', 'migrate', '--dry-run', '--output', 'plan.sql',
        ], { cwd });

        expect(written.exitCode).toBe(0);
        expect(fs.readFileSync(path.join(cwd, 'plan.sql'), 'utf8')).toContain('create table');
        expect(refused).toMatchObject({ exitCode: 1, outcome: 'error' });
        expect(refused.stderr).toContain('Refusing to overwrite existing file');
    });
});
