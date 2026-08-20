import { OperationCanceledError } from '../packages/core/src';
import type {
    MySqlConnection,
    MySqlPool,
} from '../packages/mysql/src/mysql-driver';
import { MySqlPooledConnection } from '../packages/mysql/src/mysql-pooled-connection';

function fixture(query: jest.Mock): {
    readonly connection: MySqlPooledConnection;
    readonly destroy: jest.Mock;
    readonly release: jest.Mock;
} {
    const release = jest.fn();
    const destroy = jest.fn();
    const client = {
        query,
        connection: { query: jest.fn() },
        release,
        destroy,
    } as unknown as MySqlConnection;
    const pool = {
        query: jest.fn(),
        getConnection: jest.fn().mockResolvedValue(client),
        end: jest.fn(),
    } as unknown as MySqlPool;
    return {
        connection: new MySqlPooledConnection(pool),
        destroy,
        release,
    };
}

describe('MySQL buffered query cancellation', () => {
    it('interrupts an in-flight query by destroying its owned lease', async () => {
        const query = jest.fn(async () => new Promise(() => undefined));
        const { connection, destroy, release } = fixture(query);
        const controller = new AbortController();

        const pending = connection.query(
            { text: 'select sleep(10)', values: [] },
            { signal: controller.signal },
        );
        await new Promise<void>(resolve => setImmediate(resolve));
        controller.abort('stop query');

        await expect(pending).rejects.toBeInstanceOf(OperationCanceledError);
        expect(destroy).toHaveBeenCalledTimes(1);
        expect(release).not.toHaveBeenCalled();
    });

    it('cancels cooperatively inside a transaction so rollback remains usable', async () => {
        const controller = new AbortController();
        const query = jest.fn(async (text: string) => {
            await Promise.resolve();
            if (text === 'select work') {
                controller.abort('stop transaction');
            }
            return [[], []];
        });
        const { connection, destroy, release } = fixture(query);

        await expect(connection.transaction(
            async () => connection.query(
                { text: 'select work', values: [] },
                { signal: controller.signal },
            ),
            { signal: controller.signal },
        )).rejects.toBeInstanceOf(OperationCanceledError);

        expect(query.mock.calls.map(call => call[0])).toEqual([
            'begin',
            'select work',
            'rollback',
        ]);
        expect(release).toHaveBeenCalledTimes(1);
        expect(destroy).not.toHaveBeenCalled();
    });
});
