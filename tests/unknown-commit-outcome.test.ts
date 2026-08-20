import {
    DatabaseProviderError,
    EntityState,
    type QueryStreamOptions,
    type SqlStatement,
    TransactionOutcomeUnknownError,
} from '../packages/core/src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';
import {
    createSaveChangesDb,
    User,
} from './support/save-changes-fixture';

class UnknownCommitConnection extends RecordingDatabaseConnection {
    public streamStarted = false;
    public readonly failure = new TransactionOutcomeUnknownError(
        'postgres',
        new DatabaseProviderError(
            'Postgres commit failed.',
            undefined,
            {
                provider: 'postgres',
                operation: 'commit',
                code: 'ECONNRESET',
            },
        ),
    );

    public override async transaction<TResult>(
        work: () => TResult | Promise<TResult>,
    ): Promise<TResult> {
        this.transactionEvents.push('begin');
        await work();
        this.transactionEvents.push('commit');
        throw this.failure;
    }

    public stream<
        TRow extends Record<string, unknown> = Record<string, unknown>,
    >(
        statement: SqlStatement,
        options?: QueryStreamOptions,
    ): AsyncIterable<TRow> {
        void statement;
        void options;
        this.streamStarted = true;
        return {
            async *[Symbol.asyncIterator]() {
                await Promise.resolve();
                yield {} as TRow;
            },
        };
    }
}

async function collect<T>(rows: AsyncIterable<T>): Promise<T[]> {
    const values: T[] = [];
    for await (const row of rows) {
        values.push(row);
    }
    return values;
}

function pendingUser(): User {
    const now = new Date('2026-08-03T10:00:00.000Z');
    return new User({
        id: 'usr_1',
        email: 'a@example.com',
        name: 'User',
        createdAt: now,
        updatedAt: now,
    });
}

describe('unknown commit outcomes', () => {
    it('makes the context unusable after restoring accepted tracker state', async () => {
        const connection = new UnknownCommitConnection();
        const db = createSaveChangesDb(connection);
        const user = pendingUser();
        db.users.add(user);
        connection.queueResult({ rowCount: 1 });

        await expect(db.saveChanges()).rejects.toBe(connection.failure);

        expect(db.entry(user)?.state).toBe(EntityState.Added);
        await expect(db.users.find(user.id)).rejects.toBe(connection.failure);
        await expect(db.saveChanges()).rejects.toBe(connection.failure);
        expect(connection.statements).toHaveLength(1);
    });

    it('refuses an ORM stream created before the commit outcome became unknown', async () => {
        const connection = new UnknownCommitConnection();
        const db = createSaveChangesDb(connection);
        const stream = db.users.stream();
        db.users.add(pendingUser());
        connection.queueResult({ rowCount: 1 });

        await expect(db.saveChanges()).rejects.toBe(connection.failure);

        await expect(collect(stream)).rejects.toBe(connection.failure);
        expect(connection.streamStarted).toBe(false);
    });

    it('refuses an unsafe raw stream created before the commit outcome became unknown', async () => {
        const connection = new UnknownCommitConnection();
        const db = createSaveChangesDb(connection);
        const stream = db.users
            .fromSqlUnsafe`select id, email, name, created_at, updated_at from users`
            .stream();
        db.users.add(pendingUser());
        connection.queueResult({ rowCount: 1 });

        await expect(db.saveChanges()).rejects.toBe(connection.failure);

        await expect(collect(stream)).rejects.toBe(connection.failure);
        expect(connection.streamStarted).toBe(false);
    });
});
