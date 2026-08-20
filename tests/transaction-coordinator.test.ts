import { TransactionCoordinator } from '../packages/core/src/core/transaction-coordinator';
import { RecordingDatabaseConnection } from '../packages/testing/src';

describe('TransactionCoordinator', () => {
    it('runs every after-commit callback when an earlier callback fails', async () => {
        const database = new RecordingDatabaseConnection();
        const coordinator = new TransactionCoordinator(
            () => database,
        );
        const completed: string[] = [];

        await expect(coordinator.run(() => {
            coordinator.enqueueAfterCommitCallback(() => {
                completed.push('first');
                throw new Error('first callback failed');
            });
            coordinator.enqueueAfterCommitCallback(() => {
                completed.push('second');
            });
        })).resolves.toBeUndefined();

        expect(completed).toEqual(['first', 'second']);
        expect(database.transactionEvents).toEqual(['begin', 'commit']);
    });

    it('keeps a committed transaction successful when every callback fails', async () => {
        const database = new RecordingDatabaseConnection();
        const coordinator = new TransactionCoordinator(
            () => database,
        );

        const result = coordinator.run(() => {
            coordinator.enqueueAfterCommitCallback(() => {
                throw new Error('first');
            });
            coordinator.enqueueAfterCommitCallback(() => {
                throw new Error('second');
            });
        });

        await expect(result).resolves.toBeUndefined();
        expect(database.transactionEvents).toEqual(['begin', 'commit']);
    });

    it('reports rollback cleanup failure without replacing the original error', async () => {
        const database = new RecordingDatabaseConnection();
        const callbackFailure = new Error('rollback callback failed');
        const transactionFailure = new Error('transaction failed');
        const reports: Array<{ phase: string; error: unknown }> = [];
        const completed: string[] = [];
        const coordinator = new TransactionCoordinator(
            () => database,
            (phase, error) => {
                reports.push({ phase, error });
            },
        );

        const result = coordinator.run(() => {
            coordinator.enqueueAfterCommitCallback(
                () => undefined,
                () => {
                    completed.push('earlier');
                },
            );
            coordinator.enqueueAfterCommitCallback(
                () => undefined,
                () => {
                    completed.push('failing');
                    throw callbackFailure;
                },
            );
            throw transactionFailure;
        });

        await expect(result).rejects.toBe(transactionFailure);
        expect(completed).toEqual(['failing', 'earlier']);
        expect(reports).toEqual([{
            phase: 'rollback',
            error: callbackFailure,
        }]);
    });
});
