import { runEntityKitCli } from '../../packages/cli/src/api';
import {
    createProjectWithCustomProvider,
} from './migration-cli-files-test-support';

describe('db status', () => {
    it('shows applied and pending migration status when a connection is configured', async () => {
        const cwd = createProjectWithCustomProvider([
            '20260601184530_InitialCreate',
        ]);
        await runEntityKitCli(
            ['migration', 'add', 'Initial Create'],
            { cwd, now: new Date('2026-06-01T18:45:30Z') },
        );
        await runEntityKitCli(
            ['migration', 'add', 'Add Manual Step', '--empty'],
            { cwd, now: new Date('2026-06-01T19:00:00Z') },
        );

        const status = await runEntityKitCli(['db', 'status'], { cwd });

        expect(status.exitCode).toBe(0);
        expect(status.stdout).toContain('Applied: 1');
        expect(status.stdout).toContain('Pending: 1');
        expect(status.stdout).toContain('Current: 20260601184530_InitialCreate');
        expect(status.stdout).toContain('Pending:\n  20260601190000_AddManualStep');
        expect(status.stdout).toContain('Drift: none');

        const checked = await runEntityKitCli(['db', 'status', '--check'], { cwd });
        expect(checked).toMatchObject({ exitCode: 1, outcome: 'difference' });
    });

    it('shows checksum drift with a safe next action in migration status', async () => {
        const cwd = createProjectWithCustomProvider([{
            id: '20260601184530_InitialCreate',
            name: 'InitialCreate',
            checksum: 'bad-checksum',
        }]);
        await runEntityKitCli(
            ['migration', 'add', 'Initial Create'],
            { cwd, now: new Date('2026-06-01T18:45:30Z') },
        );

        const status = await runEntityKitCli(['db', 'status'], { cwd });

        expect(status.exitCode).toBe(0);
        expect(status.stdout).toContain('Drift: 1 issue(s)');
        expect(status.stdout).toContain('20260601184530_InitialCreate: checksumMismatch');
        expect(status.stdout).toContain('Restore the applied migration file or create a corrective migration.');
    });

    it('shows unknown database migrations with a safe next action in migration status', async () => {
        const cwd = createProjectWithCustomProvider([{
            id: '20260601170000_UnknownDatabaseMigration',
            name: 'UnknownDatabaseMigration',
            checksum: 'unknown-checksum',
        }]);
        await runEntityKitCli(
            ['migration', 'add', 'Initial Create'],
            { cwd, now: new Date('2026-06-01T18:45:30Z') },
        );

        const status = await runEntityKitCli(['db', 'status'], { cwd });

        expect(status.exitCode).toBe(0);
        expect(status.stdout).toContain('Drift: 1 issue(s)');
        expect(status.stdout).toContain('20260601170000_UnknownDatabaseMigration: missingLocal');
        expect(status.stdout).toContain('Restore the exact migration file used by this database.');
    });

    it('shows dirty migration history rows with safe next actions in migration status', async () => {
        const cwd = createProjectWithCustomProvider([
            '20260601184530_InitialCreate',
            '20260601184530_InitialCreate',
            '20260601180000_OlderHistoryRow',
        ]);
        await runEntityKitCli(
            ['migration', 'add', 'Initial Create'],
            { cwd, now: new Date('2026-06-01T18:45:30Z') },
        );

        const status = await runEntityKitCli(['db', 'status'], { cwd });

        expect(status.exitCode).toBe(0);
        expect(status.stdout).toContain('Drift: 3 issue(s)');
        expect(status.stdout).toContain('20260601184530_InitialCreate: duplicateApplied');
        expect(status.stdout).toContain('20260601180000_OlderHistoryRow: outOfOrder');
        expect(status.stdout).toContain('20260601180000_OlderHistoryRow: missingLocal');
    });
});
