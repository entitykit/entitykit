import { TransactionCoordinator } from '../src/core/transaction-coordinator';
import { RecordingDatabaseConnection } from '../src/testing';

describe('TransactionCoordinator', () => {
    it('runs every after-commit callback when an earlier callback fails', async () => {
        const database = new RecordingDatabaseConnection();
        const coordinator = new TransactionCoordinator(
            () => database,
            jest.fn(),
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
        })).rejects.toThrow('first callback failed');

        expect(completed).toEqual(['first', 'second']);
        expect(database.transactionEvents).toEqual(['begin', 'commit']);
    });

    it('reports all failures after attempting every callback', async () => {
        const database = new RecordingDatabaseConnection();
        const coordinator = new TransactionCoordinator(
            () => database,
            jest.fn(),
        );

        const result = coordinator.run(() => {
            coordinator.enqueueAfterCommitCallback(() => {
                throw new Error('first');
            });
            coordinator.enqueueAfterCommitCallback(() => {
                throw new Error('second');
            });
        });

        await expect(result).rejects.toMatchObject({
            name: 'AggregateError',
            errors: [
                expect.objectContaining({ message: 'first' }),
                expect.objectContaining({ message: 'second' }),
            ],
        });
    });
});
