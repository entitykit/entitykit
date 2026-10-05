import { DatabaseProviderError, OperationCanceledError } from '../packages/core/src';
import { SqliteDatabaseConnection } from '../packages/sqlite/src/sqlite-database-connection';

const rows = {
    text: `with recursive numbers(n) as (
        select 1 union all select n + 1 from numbers where n < 100000
    ) select n from numbers`, values: [],
};

describe('SQLite stream event-loop fairness', () => {
    it('classifies native stream errors without replacing cancellation errors', async () => {
        const connection = new SqliteDatabaseConnection(':memory:');
        const statement = { text: 'select missing_column', values: [] };
        try {
            const first = connection.stream(statement).next();
            await expect(first).rejects.toBeInstanceOf(DatabaseProviderError);
            await expect(first).rejects.toMatchObject({ provider: 'sqlite', operation: 'stream', statement });
        } finally {
            await connection.dispose();
        }
    });
    it('allows a timer-driven abort during a fast consumer and cleans up its iterator', async () => {
        const connection = new SqliteDatabaseConnection(':memory:');
        const controller = new AbortController();
        let consumed = 0;
        const timer = setTimeout(() => {
            controller.abort('timer cancellation');
        }, 0);
        try {
            const consume = async (): Promise<void> => {
                for await (const row of connection.stream<{ n: number }>(rows,
                    { batchSize: 32, signal: controller.signal })) {
                    expect(row.n).toBe(++consumed);
                }
            };
            await expect(consume()).rejects.toBeInstanceOf(OperationCanceledError);
            expect(controller.signal.aborted).toBe(true);
            expect(consumed).toBeGreaterThan(0);
            expect(consumed).toBeLessThan(100_000);
            await expect(connection.query({ text: 'select 1', values: [] }))
                .resolves.toMatchObject({ rowCount: 1 });
        } finally {
            clearTimeout(timer);
            await connection.dispose();
        }
    });

    it.each([32, 1_000_000])('runs a heartbeat with bounded work for batchSize %i', async batchSize => {
        const connection = new SqliteDatabaseConnection(':memory:');
        let consumed = 0;
        const heartbeatRows: number[] = [];
        const tick = (): void => {
            heartbeatRows.push(consumed);
            heartbeat = setImmediate(tick);
        };
        let heartbeat = setImmediate(tick);
        try {
            for await (const row of connection.stream<{ n: number }>(rows, { batchSize })) {
                expect(row.n).toBe(++consumed);
            }
            expect(consumed).toBe(100_000);
            const bound = Math.min(batchSize, 256);
            expect(heartbeatRows[0]).toBe(bound);
            expect(heartbeatRows.length).toBeGreaterThan(1);
            expect(heartbeatRows.every((rows, index) =>
                rows - (heartbeatRows[index - 1] ?? 0) <= bound)).toBe(true);
            expect(consumed - (heartbeatRows.at(-1) ?? 0)).toBeLessThanOrEqual(bound);
        } finally {
            clearImmediate(heartbeat);
            await connection.dispose();
        }
    });
});
