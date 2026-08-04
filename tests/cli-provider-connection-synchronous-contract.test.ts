import type {
    DatabaseConnection,
    DatabaseProviderServices,
} from '../src/adapter';
import { createDatabaseConnection } from '../src/cli/commands/provider-connection';
import { createFakeProvider } from './support/fake-provider';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

type FactoryMode = 'resolve' | 'reject' | 'thenable';

async function connectionLater(): Promise<DatabaseConnection> {
    await Promise.resolve();
    return new RecordingDatabaseConnection();
}

async function connectionFailure(): Promise<DatabaseConnection> {
    await Promise.resolve();
    throw new Error('connection failed');
}

function connectionResult(mode: FactoryMode): unknown {
    if (mode === 'resolve') return connectionLater();
    if (mode === 'reject') return connectionFailure();
    return { then: (): void => undefined };
}

describe('CLI provider connection synchronous contract', () => {
    it.each(['resolve', 'reject', 'thenable'] as const)(
        'rejects a %s provider connection result',
        async mode => {
            const provider: DatabaseProviderServices = {
                ...createFakeProvider(),
                createConnection: (() => connectionResult(mode)) as unknown as
                    DatabaseProviderServices['createConnection'],
            };
            const unhandled: unknown[] = [];
            const observeUnhandled = (reason: unknown): void => {
                unhandled.push(reason);
            };
            process.on('unhandledRejection', observeUnhandled);
            try {
                expect(() => createDatabaseConnection(provider, {})).toThrow(
                    /Failed to create database connection.*connection factory must be synchronous/s,
                );
                await new Promise<void>(resolve => setImmediate(resolve));
                expect(unhandled).toEqual([]);
            } finally {
                process.off('unhandledRejection', observeUnhandled);
            }
        },
    );
});
