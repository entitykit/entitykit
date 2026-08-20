const mockPools: Array<{
    readonly query: jest.Mock;
    readonly getConnection: jest.Mock;
    readonly end: jest.Mock;
}> = [];

jest.mock('mysql2/promise', () => ({
    createPool: jest.fn().mockImplementation(() => {
        const pool = {
            query: jest.fn(),
            getConnection: jest.fn(),
            end: jest.fn(),
        };
        mockPools.push(pool);
        return pool;
    }),
}));

import { MySqlDatabaseConnection } from '../packages/mysql/src';

function pool(): { readonly query: jest.Mock; readonly getConnection: jest.Mock; readonly end: jest.Mock; } {
    const current = mockPools.at(-1);
    if (!current) {
        throw new Error('MySQL pool was not constructed.');
    }
    return current;
}

function client(): { query: jest.Mock; release: jest.Mock; destroy: jest.Mock; } {
    return {
        query: jest.fn().mockResolvedValue([[], []]),
        release: jest.fn(),
        destroy: jest.fn(),
    };
}

describe('MySqlDatabaseConnection sessions', () => {
    beforeEach(() => {
        mockPools.length = 0;
        jest.clearAllMocks();
    });

    it('pins every session query to one checked-out connection', async () => {
        const connection = new MySqlDatabaseConnection(
            'mysql://localhost/entitykit',
        );
        const mysqlClient = client();
        mysqlClient.query
            .mockResolvedValueOnce([[{ acquired: 1 }], []])
            .mockResolvedValueOnce([[{ released: 1 }], []]);
        pool().getConnection.mockResolvedValueOnce(mysqlClient);

        await connection.session(async () => {
            await connection.query({
                text: 'select get_lock(?, -1) as acquired',
                values: ['entitykit:migrations'],
            });
            await connection.query({
                text: 'select release_lock(?) as released',
                values: ['entitykit:migrations'],
            });
            expect(mysqlClient.release).not.toHaveBeenCalled();
        });

        expect(mysqlClient.query.mock.calls).toEqual([
            [
                'select get_lock(?, -1) as acquired',
                ['entitykit:migrations'],
            ],
            [
                'select release_lock(?) as released',
                ['entitykit:migrations'],
            ],
        ]);
        expect(pool().query).not.toHaveBeenCalled();
        expect(pool().getConnection).toHaveBeenCalledTimes(1);
        expect(mysqlClient.release).toHaveBeenCalledTimes(1);
    });

    it('runs transactions on the connection already owned by the session', async () => {
        const connection = new MySqlDatabaseConnection(
            'mysql://localhost/entitykit',
        );
        const mysqlClient = client();
        mysqlClient.query
            .mockResolvedValueOnce([[{ acquired: 1 }], []])
            .mockResolvedValueOnce([[], []])
            .mockResolvedValueOnce([[{ value: 1 }], []])
            .mockResolvedValueOnce([[], []])
            .mockResolvedValueOnce([[{ released: 1 }], []]);
        pool().getConnection.mockResolvedValueOnce(mysqlClient);

        await connection.session(async () => {
            await connection.query({
                text: 'select get_lock(?, -1) as acquired',
                values: ['entitykit:migrations'],
            });
            await connection.transaction(async () => connection.query({
                text: 'select ? as value',
                values: [1],
            }));
            await connection.query({
                text: 'select release_lock(?) as released',
                values: ['entitykit:migrations'],
            });
        });

        expect(mysqlClient.query.mock.calls).toEqual([
            ['select get_lock(?, -1) as acquired', ['entitykit:migrations']],
            ['begin', []],
            ['select ? as value', [1]],
            ['commit', []],
            ['select release_lock(?) as released', ['entitykit:migrations']],
        ]);
        expect(pool().getConnection).toHaveBeenCalledTimes(1);
        expect(mysqlClient.release).toHaveBeenCalledTimes(1);
    });

    it('normalizes session checkout failures as provider connect errors', async () => {
        const connection = new MySqlDatabaseConnection(
            'mysql://localhost/entitykit',
        );
        const cause = {
            code: 'ECONNREFUSED',
            sqlMessage: 'connect refused',
        };
        pool().getConnection.mockRejectedValueOnce(cause);

        await expect(connection.session(() => undefined))
            .rejects.toMatchObject({
                name: 'DatabaseProviderError',
                provider: 'mysql',
                operation: 'connect',
                code: 'ECONNREFUSED',
                cause,
            });
    });

    it('destroys a failed pinned session so a named lock cannot leak', async () => {
        const connection = new MySqlDatabaseConnection(
            'mysql://localhost/entitykit',
        );
        const mysqlClient = client();
        pool().getConnection.mockResolvedValueOnce(mysqlClient);

        await expect(connection.session(() => {
            throw new Error('release failed');
        })).rejects.toThrow('release failed');

        expect(mysqlClient.destroy).toHaveBeenCalledTimes(1);
        expect(mysqlClient.release).not.toHaveBeenCalled();
    });
});
