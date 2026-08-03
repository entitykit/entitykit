import { RecordingDatabaseConnection } from '../src/testing';
import {
    createOutboxUser,
    OutboxContext,
} from './support/outbox-fixture';

describe('outbox explicit transactions', () => {
    it('defers clearing events until an explicit transaction commits', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  OutboxContext.createWith(connection);
        const user = createOutboxUser([
            { type: 'UserCreated', payload: { userId: 'usr_1' } },
        ]);
        db.users.add(user);
        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rowCount: 1 });

        await db.transaction(async tx => {
            await tx.saveChanges();
            expect(user.domainEvents).toHaveLength(1);
        });

        expect(user.domainEvents).toEqual([]);
        expect(connection.transactionEvents).toEqual([
            'begin',
            'savepoint:entitykit_sp_1',
            'release:entitykit_sp_1',
            'commit',
        ]);
    });

    it('clears only events persisted before the outer commit', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  OutboxContext.createWith(connection);
        const user = createOutboxUser([
            { type: 'UserCreated', payload: { userId: 'usr_1' } },
        ]);
        db.users.add(user);
        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rowCount: 1 });

        await db.transaction(async tx => {
            await tx.saveChanges();
            user.domainEvents.push({
                type: 'WelcomeRequested',
                payload: { userId: 'usr_1' },
            });
        });

        expect(user.domainEvents.map(event => event.type)).toEqual([
            'WelcomeRequested',
        ]);

        user.email = 'updated@example.com';
        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rowCount: 1 });
        await db.saveChanges();

        expect(user.domainEvents).toEqual([]);
        expect(connection.statements
            .filter(statement => statement.text.includes('insert into "app_outbox"'))
            .map(statement => statement.values[0]))
            .toEqual(['UserCreated', 'WelcomeRequested']);
    });

    it('does not write a deferred event again on a later save', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  OutboxContext.createWith(connection);
        const user = createOutboxUser([
            { type: 'UserCreated', payload: { userId: 'usr_1' } },
        ]);
        db.users.add(user);
        for (let index = 0; index < 4; index += 1) {
            connection.queueResult({ rowCount: 1 });
        }

        await db.transaction(async tx => {
            await tx.saveChanges();
            user.email = 'updated@example.com';
            user.domainEvents.push({
                type: 'EmailChanged',
                payload: { userId: 'usr_1' },
            });
            await tx.saveChanges();
            expect(user.domainEvents).toHaveLength(2);
        });

        expect(user.domainEvents).toEqual([]);
        const outboxStatements = connection.statements.filter(statement =>
            statement.text.includes('insert into "app_outbox"'));
        expect(outboxStatements.map(statement => statement.values[0]))
            .toEqual(['UserCreated', 'EmailChanged']);
        expect(outboxStatements.every(statement => statement.values.length === 4))
            .toBe(true);
    });

    it('keeps outer outbox cleanup when an inner savepoint rolls back', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  OutboxContext.createWith(connection);
        const outer = createOutboxUser(
            [{ type: 'OuterCreated', payload: { userId: 'usr_outer' } }],
            { id: 'usr_outer', email: 'outer@example.com' },
        );
        const inner = createOutboxUser(
            [{ type: 'InnerCreated', payload: { userId: 'usr_inner' } }],
            { id: 'usr_inner', email: 'inner@example.com' },
        );
        db.users.add(outer);
        for (let index = 0; index < 4; index += 1) {
            connection.queueResult({ rowCount: 1 });
        }

        await db.transaction(async tx => {
            await tx.saveChanges();
            expect(outer.domainEvents).toHaveLength(1);

            tx.users.add(inner);
            await expect(tx.transaction(async nested => {
                await nested.saveChanges();
                throw new Error('abort inner transaction');
            })).rejects.toThrow('abort inner transaction');

            expect(outer.domainEvents).toHaveLength(1);
            expect(inner.domainEvents).toHaveLength(1);
        });

        expect(outer.domainEvents).toEqual([]);
        expect(inner.domainEvents).toHaveLength(1);
        expect(connection.transactionEvents).toContain(
            'rollback-to:entitykit_sp_1',
        );

        const statementsBeforeRetry = connection.statements.length;
        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rowCount: 1 });
        await expect(db.saveChanges()).resolves.toBe(1);
        expect(connection.statements).toHaveLength(statementsBeforeRetry + 2);

        expect(inner.domainEvents).toEqual([]);
        const publishedTypes = connection.statements
            .filter(statement => statement.text.includes('insert into "app_outbox"'))
            .map(statement => statement.values[0]);
        expect(publishedTypes).toEqual([
            'OuterCreated',
            'InnerCreated',
            'InnerCreated',
        ]);
    });

    it('keeps events when an explicit transaction rolls back after saveChanges', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  OutboxContext.createWith(connection);
        const user = createOutboxUser([
            { type: 'UserCreated', payload: { userId: 'usr_1' } },
        ]);
        db.users.add(user);
        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rowCount: 1 });

        await expect(db.transaction(async tx => {
            await tx.saveChanges();
            throw new Error('abort outer transaction');
        })).rejects.toThrow('abort outer transaction');

        expect(user.domainEvents).toHaveLength(1);
        expect(connection.transactionEvents).toEqual([
            'begin',
            'savepoint:entitykit_sp_1',
            'release:entitykit_sp_1',
            'rollback',
        ]);

        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rowCount: 1 });
        db.users.add(user);
        await db.saveChanges();
        expect(user.domainEvents).toEqual([]);
    });
});
