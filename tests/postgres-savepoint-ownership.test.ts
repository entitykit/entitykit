import {
    PostgresDatabaseConnection, createPgClient, pgPool, resetPgConnectionMocks,
} from './support/pg-database-connection-test-support';
import { containing } from './support/jest-asymmetric-matchers';

describe('Postgres nested scope ownership', () => {
    beforeEach(resetPgConnectionMocks);

    function open(): { connection: PostgresDatabaseConnection; client: ReturnType<typeof createPgClient> } {
        const connection = new PostgresDatabaseConnection('postgres://localhost/entitykit');
        const client = createPgClient();
        pgPool().connect.mockResolvedValueOnce(client);
        return { connection, client };
    }

    it('releases every caught failed scope before reusing its savepoint name', async () => {
        const { connection, client } = open();
        const active: string[] = [];
        client.query.mockImplementation(async (text: string) => {
            const name = text.split(' ').at(-1) ?? '';
            if (text.startsWith('savepoint ')) active.push(name);
            if (text.startsWith('rollback to savepoint ')) active.splice(active.lastIndexOf(name) + 1);
            if (text.startsWith('release savepoint ')) active.splice(active.lastIndexOf(name));
            return Promise.resolve({ rows: [], rowCount: 0 });
        });
        await connection.transaction(async () => {
            for (let index = 0; index < 50; index += 1) {
                const failure = new Error(`item ${String(index)}`);
                await expect(connection.transaction(() => {
                    throw failure; 
                })).rejects.toBe(failure);
                expect(active).toEqual([]);
                expect(connection.isInTransaction).toBe(true);
            }
            await expect(connection.transaction(() => 'success')).resolves.toBe('success');
            expect(active).toEqual([]);
        });
        const commands = client.query.mock.calls.map(([text]) => text as string);
        expect(commands.filter(text => text.startsWith('savepoint '))).toHaveLength(51);
        expect(commands.filter(text => text.startsWith('rollback to savepoint '))).toHaveLength(50);
        expect(commands.filter(text => text.startsWith('release savepoint '))).toHaveLength(51);
        expect(commands.at(-1)).toBe('commit');
        expect(client.release).toHaveBeenCalledTimes(1);
        expect(client.release).toHaveBeenCalledWith(undefined);
        expect(connection.isInTransaction).toBe(false);
    });

    it('cleans up cancellation immediately after creating the savepoint', async () => {
        const { connection, client } = open();
        const controller = new AbortController();
        const work = jest.fn(() => 'never');
        client.query.mockImplementation(async (text: string) => {
            if (text.startsWith('savepoint ')) controller.abort('after creation');
            return Promise.resolve({ rows: [], rowCount: 0 });
        });
        await connection.transaction(async () => {
            await expect(connection.transaction(work, { signal: controller.signal }))
                .rejects.toMatchObject({ name: 'OperationCanceledError' });
            await expect(connection.transaction(() => 'recovered')).resolves.toBe('recovered');
        });
        expect(work).not.toHaveBeenCalled();
        expect(client.query.mock.calls).toEqual([
            ['begin'], ['savepoint entitykit_sp_1'],
            ['rollback to savepoint entitykit_sp_1'], ['release savepoint entitykit_sp_1'],
            ['savepoint entitykit_sp_1'], ['release savepoint entitykit_sp_1'], ['commit'],
        ]);
        expect(client.release).toHaveBeenCalledWith(undefined);
    });

    it('does not acquire a savepoint when the nested signal is already aborted', async () => {
        const { connection, client } = open();
        const work = jest.fn(() => 'never');
        await connection.transaction(async () => {
            await expect(connection.transaction(work, { signal: AbortSignal.abort() }))
                .rejects.toMatchObject({ name: 'OperationCanceledError' });
        });
        expect(work).not.toHaveBeenCalled();
        expect(client.query.mock.calls).toEqual([['begin'], ['commit']]);
    });

    it('preserves the work error and prevents commit after caught release cleanup failure', async () => {
        const { connection, client } = open();
        const primary = new Error('item failed');
        client.query.mockImplementation(async (text: string) => text.startsWith('release savepoint ')
            ? Promise.reject(Object.assign(new Error('release failed'), { code: 'RELEASE_FAILED' }))
            : Promise.resolve({ rows: [], rowCount: 0 }));
        let nestedFailure: unknown;
        const rootFailure = await connection.transaction(async () => {
            try {
                await connection.transaction(() => {
                    throw primary; 
                });
            } catch (error) {
                nestedFailure = error;
            }
            expect(nestedFailure).toMatchObject({
                name: 'DatabaseTransactionCleanupError', operation: 'releaseSavepoint', primaryError: primary,
                cleanupError: containing({ operation: 'releaseSavepoint', code: 'RELEASE_FAILED' }),
            });
            return 'caught';
        }).catch((error: unknown) => error);
        expect(rootFailure).toBe(nestedFailure);
        expect(client.query.mock.calls).toEqual([
            ['begin'], ['savepoint entitykit_sp_1'], ['rollback to savepoint entitykit_sp_1'],
            ['release savepoint entitykit_sp_1'], ['rollback'],
        ]);
        expect(client.release).toHaveBeenCalledTimes(1);
        expect(client.release).toHaveBeenCalledWith(undefined);
    });

    it('lets an enclosing rollback and release recover a deeper release cleanup failure', async () => {
        const { connection, client } = open();
        const primary = new Error('deep work failed');
        client.query.mockImplementation(async (text: string) => text === 'release savepoint entitykit_sp_2'
            ? Promise.reject(Object.assign(new Error('deep release failed'), { code: 'DEEP_RELEASE_FAILED' }))
            : Promise.resolve({ rows: [], rowCount: 0 }));
        await expect(connection.transaction(async () => {
            await expect(connection.transaction(async () => {
                await connection.transaction(() => {
                    throw primary; 
                });
            })).rejects.toMatchObject({
                name: 'DatabaseTransactionCleanupError', primaryError: primary,
                cleanupError: containing({ code: 'DEEP_RELEASE_FAILED' }),
            });
            await connection.query({ text: 'select recovered', values: [] });
            return 'recovered';
        })).resolves.toBe('recovered');
        expect(client.query.mock.calls).toEqual([
            ['begin'], ['savepoint entitykit_sp_1'], ['savepoint entitykit_sp_2'],
            ['rollback to savepoint entitykit_sp_2'], ['release savepoint entitykit_sp_2'],
            ['rollback to savepoint entitykit_sp_1'], ['release savepoint entitykit_sp_1'],
            ['select recovered', []], ['commit'],
        ]);
        expect(client.release).toHaveBeenCalledWith(undefined);
    });
});
