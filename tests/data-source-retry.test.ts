import { createDataSource, type DatabaseProviderServices, type EntityKitDataSource } from '../src/adapter';
import {
    DatabaseProviderError,
    OperationCanceledError,
    TransactionOutcomeUnknownError,
} from '../src';
import { postgresDialect } from '../src/providers/postgres';
import {
    MigrationBuilder,
    postgresMigrationDialect,
} from '../src/migrations/api';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

const transientFailure = new Error('transient');

const retryProvider: DatabaseProviderServices = {
    name: 'retry-test',
    dialect: postgresDialect,
    migrationDialect: postgresMigrationDialect,
    createMigrationBuilder: () => new MigrationBuilder(postgresDialect),
    createConnection: () => new RecordingDatabaseConnection(),
    isTransientError: error => error === transientFailure,
};

function createSource(maxAttempts = 3): EntityKitDataSource {
    return createDataSource(retryProvider, {}, {
        retry: {
            maxAttempts,
            initialDelayMs: 0,
            maxDelayMs: 0,
            jitter: false,
        },
    });
}

describe('EntityKitDataSource retries', () => {
    it('retries a complete operation with bounded attempt context', async () => {
        const source = createSource();
        const attempts: number[] = [];

        const result = await source.executeWithRetry(({ attempt, maxAttempts }) => {
            attempts.push(attempt);
            expect(maxAttempts).toBe(3);
            if (attempt < 3) {
                throw transientFailure;
            }
            return 'done';
        });

        expect(result).toBe('done');
        expect(attempts).toEqual([1, 2, 3]);
        await source.dispose();
    });

    it('does not replay failures the provider does not classify as transient', async () => {
        const source = createSource();
        const permanent = new Error('permanent');
        const operation = jest.fn().mockRejectedValue(permanent);

        await expect(source.executeWithRetry(operation)).rejects.toBe(permanent);
        expect(operation).toHaveBeenCalledTimes(1);
        await source.dispose();
    });

    it('never replays an unknown commit outcome through a custom classifier', async () => {
        const source = createDataSource(retryProvider, {}, {
            retry: {
                maxAttempts: 3,
                initialDelayMs: 0,
                maxDelayMs: 0,
                jitter: false,
                shouldRetry: () => true,
            },
        });
        const failure = new TransactionOutcomeUnknownError(
            'postgres',
            new DatabaseProviderError(
                'Postgres commit failed.',
                undefined,
                {
                    provider: 'postgres',
                    operation: 'commit',
                    code: 'ECONNRESET',
                },
            ),
        );
        const operation = jest.fn().mockRejectedValue(failure);

        await expect(source.executeWithRetry(operation)).rejects.toBe(failure);
        expect(operation).toHaveBeenCalledTimes(1);
        await source.dispose();
    });

    it('stops before another attempt when cancellation is requested', async () => {
        const source = createDataSource(retryProvider, {}, {
            retry: {
                maxAttempts: 3,
                initialDelayMs: 1000,
                maxDelayMs: 1000,
                jitter: false,
            },
        });
        const controller = new AbortController();
        const cancelled = new Error('request cancelled');
        const operation = jest.fn().mockImplementation(() => {
            controller.abort(cancelled);
            throw transientFailure;
        });

        const canceled = source.executeWithRetry(operation, {
            signal: controller.signal,
        });
        await expect(canceled).rejects.toBeInstanceOf(OperationCanceledError);
        await expect(canceled).rejects.toMatchObject({ cause: cancelled });
        expect(operation).toHaveBeenCalledTimes(1);
        await source.dispose();
    });

    it('keeps the data source alive until an operation returns', async () => {
        const source = createSource();
        let finish: (() => void) | undefined;
        const operation = source.executeWithRetry(async () => {
            await new Promise<void>(resolve => {
                finish = resolve;
            });
        });

        await expect(source.dispose()).rejects.toThrow(/1 retry operation.*await retry operations/);
        finish?.();
        await operation;
        await expect(source.dispose()).resolves.toBeUndefined();
    });

    it('validates retry policy bounds at startup', () => {
        const createProviderDataSource = jest.fn(() => ({
            createConnection: () => new RecordingDatabaseConnection(),
        }));
        const provider: DatabaseProviderServices = {
            ...retryProvider,
            createDataSource: createProviderDataSource,
        };

        expect(() => createDataSource(provider, {}, {
            retry: { maxAttempts: 0 },
        })).toThrow('maxAttempts must be a positive integer');
        expect(() => createDataSource(provider, {}, {
            retry: { maxAttempts: 2, initialDelayMs: 10, maxDelayMs: 5 },
        })).toThrow('maxDelayMs must be greater than or equal');
        expect(() => createDataSource(provider, {}, {
            retry: { maxAttempts: 2, shouldRetry: true as never },
        })).toThrow('shouldRetry must be a function');
        expect(createProviderDataSource).not.toHaveBeenCalled();
    });

    it('validates optional provider lifecycle hooks before using them', () => {
        expect(() => createDataSource({
            ...retryProvider,
            createDataSource: true as never,
        }, {})).toThrow('createDataSource must be a function');
        expect(() => createDataSource({
            ...retryProvider,
            isTransientError: 'sometimes' as never,
        }, {})).toThrow('isTransientError must be a function');
    });

    it('preserves a failed shutdown result across repeated disposal', async () => {
        const failure = new Error('pool shutdown failed');
        const dispose = jest.fn().mockRejectedValue(failure);
        const provider: DatabaseProviderServices = {
            ...retryProvider,
            createDataSource: () => ({
                createConnection: () => new RecordingDatabaseConnection(),
                dispose,
            }),
        };
        const source = createDataSource(provider, {});

        await expect(source.dispose()).rejects.toBe(failure);
        await expect(source.dispose()).rejects.toBe(failure);
        expect(dispose).toHaveBeenCalledTimes(1);
    });
});
