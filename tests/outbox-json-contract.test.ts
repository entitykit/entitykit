import { EntityState } from '../src';
import { mySqlDialect } from '../src/providers/mysql/mysql-dialect';
import { postgresDialect } from '../src/providers/postgres';
import { sqliteDialect } from '../src/providers/sqlite';
import type { SqlDialect } from '../src/sql/sql-dialect';
import { RecordingDatabaseConnection } from '../src/testing';
import {
    createOutboxUser,
    type DomainEvent,
    OutboxContext,
} from './support/outbox-fixture';

function invalidEvent(payload: unknown, aggregateId: unknown = 'usr_1'): DomainEvent {
    return {
        type: 'UserCreated',
        payload,
        aggregateId,
    } as unknown as DomainEvent;
}

async function expectPreSqlFailure(
    event: DomainEvent,
    expected = 'Unsupported JSON value',
): Promise<void> {
    const connection = new RecordingDatabaseConnection();
    const db = OutboxContext.createWith(connection);
    const user = createOutboxUser([event]);
    db.users.add(user);

    await expect(db.saveChanges()).rejects.toThrow(expected);
    expect(connection.statements).toEqual([]);
    expect(connection.transactionEvents).toEqual([]);
    expect(user.domainEvents).toEqual([event]);
    expect(db.entry(user)?.state).toBe(EntityState.Added);
}

describe('outbox JSON contract', () => {
    it.each([
        ['Promise payload', invalidEvent(Promise.resolve({ ok: true }))],
        ['nested Promise', invalidEvent({ nested: Promise.resolve(true) })],
        ['custom thenable', invalidEvent({ then: (): void => undefined })],
        ['Map payload', invalidEvent(new Map([['key', 'value']]))],
        ['non-finite number', invalidEvent({ score: Number.NaN })],
        ['Promise aggregate id', invalidEvent({ ok: true }, Promise.resolve('usr_1'))],
    ])('rejects a %s before starting SQL', async (_label, event) => {
        await expectPreSqlFailure(event);
    });

    it('consumes a rejected payload Promise and remains retryable', async () => {
        const unhandled: unknown[] = [];
        const observeUnhandled = (reason: unknown): void => {
            unhandled.push(reason);
        };
        process.on('unhandledRejection', observeUnhandled);
        try {
            const connection = new RecordingDatabaseConnection();
            const event = invalidEvent(Promise.reject(new Error('payload failed')));
            const user = createOutboxUser([event]);
            const db = OutboxContext.createWith(connection);
            db.users.add(user);

            await expect(db.saveChanges()).rejects.toThrow('Promise or thenable');
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(unhandled).toEqual([]);
            expect(connection.statements).toEqual([]);
            expect(user.domainEvents).toEqual([event]);
            expect(db.entry(user)?.state).toBe(EntityState.Added);

            (event as unknown as { payload: unknown }).payload = { ok: true };
            connection.queueResult({ rowCount: 1 });
            connection.queueResult({ rowCount: 1 });
            await expect(db.saveChanges()).resolves.toBe(1);
            expect(user.domainEvents).toEqual([]);
        } finally {
            process.off('unhandledRejection', observeUnhandled);
        }
    });

    it('rejects an invalid event timestamp before starting SQL', async () => {
        const event: DomainEvent = {
            type: 'UserCreated',
            payload: { ok: true },
        };
        (event as DomainEvent & { occurredAt: Date }).occurredAt =
            new Date(Number.NaN);
        await expectPreSqlFailure(
            event,
            'Outbox event "UserCreated" occurredAt must be a valid Date.',
        );
    });

    it.each([
        ['Postgres', postgresDialect],
        ['SQLite', sqliteDialect],
        ['MySQL', mySqlDialect],
    ] satisfies ReadonlyArray<readonly [string, SqlDialect]>) (
        'serializes valid values identically for %s',
        (_label, dialect) => {
            const connection = new RecordingDatabaseConnection();
            const db = OutboxContext.createWith(connection, undefined, dialect);
            const user = createOutboxUser([{
                type: 'UserCreated',
                payload: { flags: [true, false], count: 2 },
                aggregateId: { tenant: 'acme', id: 7 },
            }]);
            db.users.attach(user);

            expect(db.getSavePlan()[0]?.statement.values.slice(0, 3)).toEqual([
                'UserCreated',
                '{"flags":[true,false],"count":2}',
                '{"tenant":"acme","id":7}',
            ]);
        },
    );
});
