import { TransactionCoordinator } from '../src/core/transaction-coordinator';
import { RecordingDatabaseConnection } from '../src/testing';

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
});
