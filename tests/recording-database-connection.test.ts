import { RecordingDatabaseConnection } from '../packages/testing/src';

describe('RecordingDatabaseConnection', () => {
    it('returns an empty result when no result is queued', async () => {
        const connection = new RecordingDatabaseConnection();
        const statement = { text: 'select 1', values: [] };

        await expect(connection.query(statement)).resolves.toEqual({ rows: [], rowCount: 0 });

        expect(connection.statements).toEqual([statement]);
        expect(connection.operations).toEqual([{ kind: 'query', statement }]);
    });

    it('records statements before throwing queued errors', async () => {
        const connection = new RecordingDatabaseConnection();
        const error = new Error('database unavailable');
        const statement = { text: 'select 1', values: [] };
        connection.queueError(error);

        await expect(connection.query(statement)).rejects.toBe(error);

        expect(connection.statements).toEqual([statement]);
        expect(connection.operations).toEqual([{ kind: 'query', statement }]);
    });

    it('streams queued rows and records the streaming operation', async () => {
        const connection = new RecordingDatabaseConnection();
        const statement = { text: 'select id from users', values: [] };
        connection.queueResult({ rows: [{ id: 'one' }, { id: 'two' }] });
        const rows: Array<Record<string, unknown>> = [];

        for await (const row of connection.stream(statement, { batchSize: 1 })) {
            rows.push(row);
        }

        expect(rows).toEqual([{ id: 'one' }, { id: 'two' }]);
        expect(connection.operations).toEqual([{ kind: 'stream', statement }]);
    });

    it('records only the outer session for nested session scopes', async () => {
        const connection = new RecordingDatabaseConnection();

        await connection.session(async () => {
            await connection.session(async () => {
                await connection.query({ text: 'select 1', values: [] });
            });
        });

        expect(connection.sessionEvents).toEqual(['start', 'end']);
        expect(connection.statements).toEqual([{ text: 'select 1', values: [] }]);
        expect(connection.operations).toEqual([
            { kind: 'session-start' },
            { kind: 'query', statement: { text: 'select 1', values: [] } },
            { kind: 'session-end' },
        ]);
    });

    it('can inject transaction lifecycle failures through the testing subpath', async () => {
        const connection = new RecordingDatabaseConnection();
        const failure = new Error('commit failed');
        connection.failNextTransactionCommit(failure);

        await expect(connection.transaction(() => undefined)).rejects.toBe(failure);

        expect(connection.operations).toEqual([
            { kind: 'begin' },
            { kind: 'rollback' },
        ]);
        expect(connection.transactionEvents).toEqual(['begin', 'rollback']);
    });

    it('records nested transactions as savepoints', async () => {
        const connection = new RecordingDatabaseConnection();

        await connection.transaction(async () => {
            expect(connection.isInTransaction).toBe(true);
            await connection.transaction(() => 'nested');
        });

        expect(connection.isInTransaction).toBe(false);
        expect(connection.transactionEvents).toEqual([
            'begin',
            'savepoint:entitykit_sp_1',
            'release:entitykit_sp_1',
            'commit',
        ]);
        expect(connection.operations).toEqual([
            { kind: 'begin' },
            { kind: 'savepoint', savepointName: 'entitykit_sp_1' },
            { kind: 'release-savepoint', savepointName: 'entitykit_sp_1' },
            { kind: 'commit' },
        ]);
    });

    it('rolls back the savepoint and outer transaction after a nested failure', async () => {
        const connection = new RecordingDatabaseConnection();
        const failure = new Error('nested work failed');

        await expect(
            connection.transaction(async () => connection.transaction(() => {
                throw failure;
            })),
        ).rejects.toBe(failure);

        expect(connection.isInTransaction).toBe(false);
        expect(connection.transactionEvents).toEqual([
            'begin',
            'savepoint:entitykit_sp_1',
            'rollback-to:entitykit_sp_1',
            'rollback',
        ]);
    });

    it('can inject nested transaction cleanup failures', async () => {
        const connection = new RecordingDatabaseConnection();
        const failure = new Error('rollback to savepoint failed');
        connection.failNextRollbackToSavepoint(failure);

        await expect(
            connection.transaction(async () => connection.transaction(() => {
                throw new Error('nested work failed');
            })),
        ).rejects.toBe(failure);

        expect(connection.isInTransaction).toBe(false);
        expect(connection.transactionEvents).toEqual([
            'begin',
            'savepoint:entitykit_sp_1',
            'rollback',
        ]);
    });
});
