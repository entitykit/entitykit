import {
    PostgresDatabaseConnection,
    createPgClient,
    pgPool,
    resetPgConnectionMocks,
} from './support/pg-database-connection-test-support';
import { containing } from './support/jest-asymmetric-matchers';

describe('PostgresDatabaseConnection savepoints', () => {
    beforeEach(resetPgConnectionMocks);

    it('uses savepoints for nested transactions', async () => {
        const connection = new PostgresDatabaseConnection('postgres://localhost/entitykit');
        const pgClient = createPgClient();
        pgPool().connect.mockResolvedValueOnce(pgClient);

        await connection.transaction(async () => {
            await connection.transaction(async () => {
                await connection.query({ text: 'select nested', values: [] });
            });
        });

        expect(pgClient.query.mock.calls).toEqual([
            ['begin'],
            ['savepoint entitykit_sp_1'],
            ['select nested', []],
            ['release savepoint entitykit_sp_1'],
            ['commit'],
        ]);
    });

    it('rolls back to a savepoint and keeps the outer transaction usable', async () => {
        const connection = new PostgresDatabaseConnection('postgres://localhost/entitykit');
        const pgClient = createPgClient();
        pgPool().connect.mockResolvedValueOnce(pgClient);

        await connection.transaction(async () => {
            await expect(connection.transaction(async () => {
                await connection.query({ text: 'select nested', values: [] });
                throw new Error('inner failed');
            })).rejects.toThrow('inner failed');

            await connection.query({ text: 'select outer', values: [] });
        });

        expect(pgClient.query.mock.calls).toEqual([
            ['begin'],
            ['savepoint entitykit_sp_1'],
            ['select nested', []],
            ['rollback to savepoint entitykit_sp_1'],
            ['select outer', []],
            ['commit'],
        ]);
        expect(pgClient.release).toHaveBeenCalledTimes(1);
    });

    it('wraps savepoint command failures', async () => {
        const connection = new PostgresDatabaseConnection('postgres://localhost/entitykit');
        const pgClient = createPgClient();
        pgClient.query.mockResolvedValueOnce(undefined);
        pgClient.query.mockRejectedValueOnce({ code: 'SAVEPOINT_FAILED' });
        pgClient.query.mockResolvedValueOnce(undefined);
        pgPool().connect.mockResolvedValueOnce(pgClient);

        await expect(connection.transaction(async () => {
            await connection.transaction(() => 'never');
        })).rejects.toMatchObject({
            name: 'DatabaseProviderError',
            operation: 'savepoint',
            code: 'SAVEPOINT_FAILED',
        });
        expect(pgClient.query.mock.calls).toEqual([
            ['begin'],
            ['savepoint entitykit_sp_1'],
            ['rollback'],
        ]);
        expect(pgClient.release).toHaveBeenCalledTimes(1);
    });

    it('rolls back the root when application code catches a failed savepoint', async () => {
        const connection = new PostgresDatabaseConnection('postgres://localhost/entitykit');
        const pgClient = createPgClient();
        pgClient.query.mockResolvedValueOnce(undefined);
        pgClient.query.mockRejectedValueOnce({ code: 'SAVEPOINT_FAILED' });
        pgClient.query.mockResolvedValueOnce(undefined);
        pgPool().connect.mockResolvedValueOnce(pgClient);

        await expect(connection.transaction(async () => {
            await expect(connection.transaction(() => 'never'))
                .rejects.toMatchObject({ operation: 'savepoint' });
            return 'caught';
        })).rejects.toMatchObject({
            operation: 'savepoint',
            code: 'SAVEPOINT_FAILED',
        });

        expect(pgClient.query.mock.calls).toEqual([
            ['begin'],
            ['savepoint entitykit_sp_1'],
            ['rollback'],
        ]);
    });

    it('wraps release-savepoint failures', async () => {
        const connection = new PostgresDatabaseConnection('postgres://localhost/entitykit');
        const pgClient = createPgClient();
        pgClient.query.mockResolvedValueOnce(undefined);
        pgClient.query.mockResolvedValueOnce(undefined);
        pgClient.query.mockRejectedValueOnce({ code: 'RELEASE_SAVEPOINT_FAILED' });
        pgClient.query.mockResolvedValueOnce(undefined);
        pgPool().connect.mockResolvedValueOnce(pgClient);

        await expect(connection.transaction(async () => {
            await connection.transaction(() => 'ok');
        })).rejects.toMatchObject({
            name: 'DatabaseProviderError',
            operation: 'releaseSavepoint',
            code: 'RELEASE_SAVEPOINT_FAILED',
        });
        expect(pgClient.query.mock.calls).toEqual([
            ['begin'],
            ['savepoint entitykit_sp_1'],
            ['release savepoint entitykit_sp_1'],
            ['rollback to savepoint entitykit_sp_1'],
            ['rollback'],
        ]);
        expect(pgClient.release).toHaveBeenCalledTimes(1);
    });

    it('wraps rollback-to-savepoint failures', async () => {
        const connection = new PostgresDatabaseConnection('postgres://localhost/entitykit');
        const pgClient = createPgClient();
        pgClient.query.mockResolvedValueOnce(undefined);
        pgClient.query.mockResolvedValueOnce(undefined);
        pgClient.query.mockRejectedValueOnce({ code: 'ROLLBACK_TO_SAVEPOINT_FAILED' });
        pgClient.query.mockResolvedValueOnce(undefined);
        pgPool().connect.mockResolvedValueOnce(pgClient);

        await expect(connection.transaction(async () => {
            await connection.transaction(() => {
                throw new Error('inner failed');
            });
        })).rejects.toMatchObject({
            name: 'DatabaseTransactionCleanupError',
            operation: 'rollbackToSavepoint',
            cleanupError: containing({
                name: 'DatabaseProviderError',
                operation: 'rollbackToSavepoint',
                code: 'ROLLBACK_TO_SAVEPOINT_FAILED',
            }),
        });
        expect(pgClient.query.mock.calls).toEqual([
            ['begin'],
            ['savepoint entitykit_sp_1'],
            ['rollback to savepoint entitykit_sp_1'],
            ['rollback'],
        ]);
        expect(pgClient.release).toHaveBeenCalledTimes(1);
    });

    it('preserves nested work failures when rollback-to-savepoint cleanup fails', async () => {
        const connection = new PostgresDatabaseConnection('postgres://localhost/entitykit');
        const pgClient = createPgClient();
        pgClient.query.mockResolvedValueOnce(undefined);
        pgClient.query.mockResolvedValueOnce(undefined);
        pgClient.query.mockRejectedValueOnce({ code: 'ROLLBACK_TO_SAVEPOINT_FAILED' });
        pgClient.query.mockResolvedValueOnce(undefined);
        pgPool().connect.mockResolvedValueOnce(pgClient);

        await expect(connection.transaction(async () => {
            await connection.transaction(() => {
                throw new Error('inner failed');
            });
        })).rejects.toMatchObject({
            name: 'DatabaseTransactionCleanupError',
            operation: 'rollbackToSavepoint',
            primaryError: containing({ message: 'inner failed' }),
            cleanupError: containing({
                name: 'DatabaseProviderError',
                operation: 'rollbackToSavepoint',
                code: 'ROLLBACK_TO_SAVEPOINT_FAILED',
            }),
        });
        expect(pgClient.query.mock.calls).toEqual([
            ['begin'],
            ['savepoint entitykit_sp_1'],
            ['rollback to savepoint entitykit_sp_1'],
            ['rollback'],
        ]);
        expect(pgClient.release).toHaveBeenCalledTimes(1);
    });

    it('cannot commit when application code catches failed savepoint cleanup', async () => {
        const connection = new PostgresDatabaseConnection('postgres://localhost/entitykit');
        const pgClient = createPgClient();
        pgClient.query
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce({ code: 'ROLLBACK_TO_SAVEPOINT_FAILED' })
            .mockResolvedValueOnce(undefined);
        pgPool().connect.mockResolvedValueOnce(pgClient);

        await expect(connection.transaction(async () => {
            await expect(connection.transaction(() => {
                throw new Error('inner failed');
            })).rejects.toMatchObject({
                name: 'DatabaseTransactionCleanupError',
            });
            return 'caught';
        })).rejects.toMatchObject({
            name: 'DatabaseTransactionCleanupError',
            operation: 'rollbackToSavepoint',
        });

        expect(pgClient.query.mock.calls).toEqual([
            ['begin'],
            ['savepoint entitykit_sp_1'],
            ['rollback to savepoint entitykit_sp_1'],
            ['rollback'],
        ]);
    });

    it('does not let an unrelated savepoint rollback recover an earlier failure', async () => {
        const connection = new PostgresDatabaseConnection('postgres://localhost/entitykit');
        const pgClient = createPgClient();
        const laterFailure = new Error('later application failure');
        pgClient.query
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce({ code: 'SAVEPOINT_FAILED' })
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce(undefined);
        pgPool().connect.mockResolvedValueOnce(pgClient);

        await expect(connection.transaction(async () => {
            await expect(connection.transaction(() => 'never'))
                .rejects.toMatchObject({ operation: 'savepoint' });
            await expect(connection.transaction(() => {
                throw laterFailure;
            })).rejects.toBe(laterFailure);
            return 'caught';
        })).rejects.toMatchObject({
            operation: 'savepoint',
            code: 'SAVEPOINT_FAILED',
        });

        expect(pgClient.query.mock.calls).toEqual([
            ['begin'],
            ['savepoint entitykit_sp_1'],
            ['savepoint entitykit_sp_1'],
            ['rollback to savepoint entitykit_sp_1'],
            ['rollback'],
        ]);
    });

    it('allows an enclosing savepoint rollback to recover deeper cleanup failure', async () => {
        const connection = new PostgresDatabaseConnection('postgres://localhost/entitykit');
        const pgClient = createPgClient();
        pgClient.query
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce({ code: 'DEEP_ROLLBACK_FAILED' })
            .mockResolvedValueOnce(undefined)
            .mockResolvedValueOnce({ rows: [], rowCount: 0 })
            .mockResolvedValueOnce(undefined);
        pgPool().connect.mockResolvedValueOnce(pgClient);

        await expect(connection.transaction(async () => {
            await expect(connection.transaction(async () => {
                await connection.transaction(() => {
                    throw new Error('deep failure');
                });
            })).rejects.toMatchObject({
                name: 'DatabaseTransactionCleanupError',
            });
            await connection.query({ text: 'select recovered', values: [] });
            return 'recovered';
        })).resolves.toBe('recovered');

        expect(pgClient.query.mock.calls).toEqual([
            ['begin'],
            ['savepoint entitykit_sp_1'],
            ['savepoint entitykit_sp_2'],
            ['rollback to savepoint entitykit_sp_2'],
            ['rollback to savepoint entitykit_sp_1'],
            ['select recovered', []],
            ['commit'],
        ]);
    });
});
