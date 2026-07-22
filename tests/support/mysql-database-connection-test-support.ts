const mockPools: MockMySqlPool[] = [];

jest.mock('mysql2/promise', () => ({
    createPool: jest.fn().mockImplementation((config: unknown) => {
        const pool: MockMySqlPool = {
            config,
            query: jest.fn(),
            getConnection: jest.fn(),
            end: jest.fn(),
        };
        mockPools.push(pool);
        return pool;
    }),
}));

import {
    createMySqlDataSource,
    MySqlDatabaseConnection,
} from '../../src/providers/mysql';

export interface MockMySqlPool {
    readonly config: unknown;
    readonly query: jest.Mock;
    readonly getConnection: jest.Mock;
    readonly end: jest.Mock;
}

export interface MockMySqlClient {
    readonly query: jest.Mock;
    readonly release: jest.Mock;
    readonly destroy: jest.Mock;
}

export { createMySqlDataSource, MySqlDatabaseConnection };

export function mysqlPool(): MockMySqlPool {
    const current = mockPools.at(-1);
    if (!current) {
        throw new Error('MySQL pool was not constructed.');
    }
    return current;
}

export function mysqlPoolCount(): number {
    return mockPools.length;
}

export function createMysqlClient(): MockMySqlClient {
    return {
        query: jest.fn().mockResolvedValue([[], []]),
        release: jest.fn(),
        destroy: jest.fn(),
    };
}

export function resetMysqlConnectionMocks(): void {
    mockPools.length = 0;
    jest.clearAllMocks();
}
