import type {
    DatabaseConnection,
    DatabaseQueryResult,
    SqlStatement,
} from '../packages/core/src';
import { MySqlSchemaIntrospector } from '../packages/mysql/src';
import { PostgresSchemaIntrospector } from '../packages/postgres/src';

describe('schema introspector query sequencing', () => {
    it('serializes Postgres catalog queries on one connection', async () => {
        const connection = new ConcurrentQueryRejectingConnection();

        await expect(new PostgresSchemaIntrospector(connection).introspect())
            .resolves.toEqual({ schemas: [] });
        expect(connection.queryCount).toBe(6);
    });

    it('serializes MySQL catalog queries on one connection', async () => {
        const connection = new ConcurrentQueryRejectingConnection('app');

        await expect(new MySqlSchemaIntrospector(connection).introspect())
            .resolves.toEqual({ schemas: [] });
        expect(connection.queryCount).toBe(6);
    });
});

class ConcurrentQueryRejectingConnection implements DatabaseConnection {
    public readonly isInTransaction = false;
    public queryCount = 0;
    private active = false;

    constructor(private readonly currentDatabase?: string) {}

    public async query<TRow extends Record<string, unknown>>(
        statement: SqlStatement,
    ): Promise<DatabaseQueryResult<TRow>> {
        if (this.active) {
            throw new Error('Concurrent query detected.');
        }
        this.active = true;
        this.queryCount += 1;
        try {
            await Promise.resolve();
            const rows = statement.text === 'select database() as db'
                ? [{ db: this.currentDatabase ?? null }]
                : [];
            return { rows: rows as unknown as TRow[], rowCount: rows.length };
        } finally {
            this.active = false;
        }
    }

    public async transaction<TResult>(
        work: () => TResult | Promise<TResult>,
    ): Promise<TResult> {
        return work();
    }
}
