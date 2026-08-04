import type {
    DatabaseConnection,
    DatabaseConnectionSource,
    DatabaseProviderServices,
} from '../src/adapter';
import { createDataSource } from '../src/adapter';
import { DbContextOptionsBuilder } from '../src/core/context-options/db-context-options-builder';
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

function providerWithConnectionFactory(mode: FactoryMode): DatabaseProviderServices {
    return {
        ...createFakeProvider(),
        createConnection: (() => connectionResult(mode)) as unknown as
            DatabaseProviderServices['createConnection'],
    };
}

describe('database connection factory synchronous contract', () => {
    it.each(['resolve', 'reject', 'thenable'] as const)(
        'rejects a %s result from a context provider factory',
        async mode => {
            const unhandled: unknown[] = [];
            const observeUnhandled = (reason: unknown): void => {
                unhandled.push(reason);
            };
            process.on('unhandledRejection', observeUnhandled);
            try {
                expect(() => new DbContextOptionsBuilder()
                    .useProvider(providerWithConnectionFactory(mode), {})
                    .build()).toThrow(
                    'Database provider \'fake-provider\' connection factory must be synchronous',
                );
                await new Promise<void>(resolve => setImmediate(resolve));
                expect(unhandled).toEqual([]);
            } finally {
                process.off('unhandledRejection', observeUnhandled);
            }
        },
    );

    it('rejects an asynchronous provider data-source factory', async () => {
        const provider: DatabaseProviderServices = {
            ...createFakeProvider(),
            createDataSource: (async (): Promise<DatabaseConnectionSource> => {
                await Promise.resolve();
                return { createConnection: () => new RecordingDatabaseConnection() };
            }) as unknown as NonNullable<DatabaseProviderServices['createDataSource']>,
        };

        expect(() => createDataSource(provider, {})).toThrow(
            'Database provider \'fake-provider\' data-source factory must be synchronous',
        );
        await new Promise<void>(resolve => setImmediate(resolve));
    });

    it('rejects an asynchronous data-source connection factory', async () => {
        const provider: DatabaseProviderServices = {
            ...createFakeProvider(),
            createDataSource: () => ({
                createConnection: (async () => {
                    await Promise.resolve();
                    return new RecordingDatabaseConnection();
                }) as unknown as
                    DatabaseConnectionSource['createConnection'],
            }),
        };
        const source = createDataSource(provider, {});

        expect(() => source.createConnection()).toThrow(
            'Database data source \'fake-provider\' connection factory must be synchronous',
        );
        await new Promise<void>(resolve => setImmediate(resolve));
        await source.dispose();
    });
});
