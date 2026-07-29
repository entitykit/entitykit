import { DatabaseTransactionCleanupError } from '../../src';
import {
    DiagnosticsContext,
    resetDiagnosticsContext,
} from './diagnostics-test-support';
import {
    anyError,
    anyNumber,
    containing,
} from '../support/jest-asymmetric-matchers';
import { createPostgresProviderError } from '../../src/providers/postgres/postgres-provider-error';

describe('transaction diagnostics', () => {
    beforeEach(resetDiagnosticsContext);

    it('emits transaction begin, commit, and rollback diagnostics', async () => {
        const db =  DiagnosticsContext.create();

        await db.database.connection.transaction(() => undefined);
        await expect(db.database.connection.transaction(() => {
            throw new Error('rollback me');
        })).rejects.toThrow('rollback me');

        expect(DiagnosticsContext.events).toEqual([
            { kind: 'transaction', provider: 'diagnostic-test', phase: 'begin' },
            containing({
                kind: 'transaction',
                provider: 'diagnostic-test',
                phase: 'commit',
                durationMs: anyNumber(),
            }),
            { kind: 'transaction', provider: 'diagnostic-test', phase: 'begin' },
            containing({
                kind: 'transaction',
                provider: 'diagnostic-test',
                phase: 'rollback',
                durationMs: anyNumber(),
                error: anyError(),
            }),
        ]);
    });

    it('emits savepoint, release, and rollback-to-savepoint diagnostics for nested transactions', async () => {
        const db =  DiagnosticsContext.create();

        await db.database.connection.transaction(async () => {
            await db.database.connection.transaction(() => undefined);
            await expect(db.database.connection.transaction(() => {
                throw new Error('nested rollback');
            })).rejects.toThrow('nested rollback');
        });

        expect(DiagnosticsContext.events).toEqual([
            { kind: 'transaction', provider: 'diagnostic-test', phase: 'begin' },
            { kind: 'transaction', provider: 'diagnostic-test', phase: 'savepoint' },
            containing({
                kind: 'transaction',
                provider: 'diagnostic-test',
                phase: 'release',
                durationMs: anyNumber(),
            }),
            { kind: 'transaction', provider: 'diagnostic-test', phase: 'savepoint' },
            containing({
                kind: 'transaction',
                provider: 'diagnostic-test',
                phase: 'rollbackToSavepoint',
                durationMs: anyNumber(),
                error: anyError(),
            }),
            containing({
                kind: 'transaction',
                provider: 'diagnostic-test',
                phase: 'commit',
                durationMs: anyNumber(),
            }),
        ]);
    });

    it('emits the failed transaction lifecycle phase for provider transaction errors', async () => {
        const db =  DiagnosticsContext.create();
        const failure = createPostgresProviderError('commit', { code: 'COMMIT_FAILED' });
        DiagnosticsContext.connection.failNextTransactionCommit(failure);

        await expect(db.database.connection.transaction(() => undefined)).rejects.toBe(failure);

        expect(DiagnosticsContext.events).toEqual([
            { kind: 'transaction', provider: 'diagnostic-test', phase: 'begin' },
            containing({
                kind: 'transaction',
                provider: 'diagnostic-test',
                phase: 'commit',
                durationMs: anyNumber(),
                error: failure,
            }),
        ]);
    });

    it('emits cleanup transaction diagnostics without losing the original error', async () => {
        const db =  DiagnosticsContext.create();
        const primary = new Error('work failed');
        const cleanup = createPostgresProviderError('rollback', { code: 'ROLLBACK_FAILED' });
        const failure = new DatabaseTransactionCleanupError('postgres', primary, cleanup);
        DiagnosticsContext.connection.failNextTransactionRollback(failure);

        await expect(db.database.connection.transaction(() => {
            throw primary;
        })).rejects.toBe(failure);

        expect(DiagnosticsContext.events).toEqual([
            { kind: 'transaction', provider: 'diagnostic-test', phase: 'begin' },
            containing({
                kind: 'transaction',
                provider: 'diagnostic-test',
                phase: 'rollback',
                durationMs: anyNumber(),
                error: failure,
            }),
        ]);
        expect(failure.primaryError).toBe(primary);
        expect(failure.cleanupError).toBe(cleanup);
    });
});
