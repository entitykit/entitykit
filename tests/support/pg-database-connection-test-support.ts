const mockPools: MockPgPool[] = [];

jest.mock('pg', () => ({
    Pool: jest.fn().mockImplementation((config: unknown) => {
        const pool: MockPgPool = {
            config,
            query: jest.fn(),
            connect: jest.fn(),
            end: jest.fn(),
            on: jest.fn((event: 'error', listener: (error: Error) => void) => {
                pool.errorListener = listener;
            }),
        };
        mockPools.push(pool);
        return pool;
    }),
}));

import {
    createPostgresDataSource,
    PostgresDatabaseConnection,
} from '../../src/providers/postgres';

export interface MockPgPool {
    readonly config: unknown;
    readonly query: jest.Mock;
    readonly connect: jest.Mock;
    readonly end: jest.Mock;
    readonly on: jest.Mock;
    errorListener?: (error: Error) => void;
}

export interface MockPgClient {
    readonly query: jest.Mock;
    readonly release: jest.Mock;
}

export { createPostgresDataSource, PostgresDatabaseConnection };

export function pgPool(): MockPgPool {
    const current = mockPools.at(-1);
    if (!current) {
        throw new Error('Postgres pool was not constructed.');
    }
    return current;
}

export function pgPoolCount(): number {
    return mockPools.length;
}

export function createPgClient(): MockPgClient {
    return {
        query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
        release: jest.fn(),
    };
}

export function resetPgConnectionMocks(): void {
    mockPools.length = 0;
    jest.clearAllMocks();
}
