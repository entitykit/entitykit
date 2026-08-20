import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext, EntityNotFoundError, MultipleEntitiesFoundError } from '../packages/core/src';
import { RecordingDatabaseConnection } from '../packages/testing/src';

class QueryUser {
    public id!: string;
    public email!: string;
    public name!: string;
    public createdAt!: Date;
}

let activeConnection: RecordingDatabaseConnection;

class QueryContext extends DbContext {
    public users = this.set(QueryUser);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(activeConnection);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(QueryUser, entity => {
            entity.toTable('query_users');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(user => user.email).hasColumnName('email').hasColumnType('text').isRequired();
            entity.property(user => user.name).hasColumnName('name').hasColumnType('text').isRequired();
            entity.property(user => user.createdAt).hasColumnName('created_at').hasColumnType('timestamptz').isRequired();
        });
    }
}

describe('CRUD query conveniences', () => {
    beforeEach(() => {
        activeConnection = new RecordingDatabaseConnection();
    });

    it('compiles string convenience operators to parameterized like predicates', async () => {
        const db =  QueryContext.create();
        activeConnection.queueResult({ rows: [], rowCount: 0 });

        await db.users
            .where(user => user.email.contains('@example.com'))
            .whereIf(true, user => user.name.startsWith('Sha'))
            .whereIf(false, user => user.name.endsWith('ignored'))
            .toArray();

        expect(activeConnection.statements[0]?.text).toContain('"email" like $1');
        expect(activeConnection.statements[0]?.text).toContain('"name" like $2');
        expect(activeConnection.statements[0]?.values).toEqual(['%@example.com%', 'Sha%']);
    });

    it('supports throwing, nullable, find-or-throw, and existence terminals', async () => {
        const db =  QueryContext.create();
        activeConnection.queueResult({ rows: [], rowCount: 0 });
        await expect(db.users.first()).rejects.toBeInstanceOf(EntityNotFoundError);

        activeConnection.queueResult({ rows: [], rowCount: 0 });
        await expect(db.users.findOrThrow('missing')).rejects.toBeInstanceOf(EntityNotFoundError);

        activeConnection.queueResult({ rows: [{ id: 'usr_1', email: 'a', name: 'A', created_at: new Date() }], rowCount: 1 });
        await expect(db.users.singleOrNull()).resolves.toBeInstanceOf(QueryUser);

        activeConnection.queueResult({ rows: [{ id: 'usr_1', email: 'a', name: 'A', created_at: new Date() }, { id: 'usr_2', email: 'b', name: 'B', created_at: new Date() }], rowCount: 2 });
        await expect(db.users.singleOrNull()).rejects.toBeInstanceOf(MultipleEntitiesFoundError);

        activeConnection.queueResult({ rows: [{ exists: true }], rowCount: 1 });
        await expect(db.users.exists()).resolves.toBe(true);
    });
});
