import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext, EntityState } from '../packages/core/src';
import type { SqlDialect } from '../packages/core/src/adapter';
import {
    postgres,
    rawSql as postgresRawSql,
} from '../packages/postgres/src';
import { rawSql as sqliteRawSql } from '../packages/sqlite/src';
import { rawSql as mysqlRawSql } from '../packages/mysql/src';
import { User } from '../packages/core/src/examples';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class RawSqlContext extends DbContext {
    public static connection: RecordingDatabaseConnection;

    public users = this.set(User);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(RawSqlContext.connection);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(User, entity => {
            entity.toTable('users');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(user => user.email).hasColumnName('email').hasColumnType('text').isRequired();
            entity.property(user => user.name).hasColumnName('name').hasColumnType('text').isRequired();
            entity.property(user => user.createdAt).hasColumnName('created_at').hasColumnType('timestamptz').isRequired();
            entity.property(user => user.updatedAt).hasColumnName('updated_at').hasColumnType('timestamptz').isRequired();
        });
    }
}

const questionMarkDialect: SqlDialect = {
    name: 'question-mark-sql',
    quoteIdentifier(identifier: string): string {
        return `[${identifier}]`;
    },
    quoteQualifiedIdentifier(...identifiers: ReadonlyArray<string | undefined>): string {
        return identifiers.filter(Boolean).map(identifier => `[${String(identifier)}]`).join('.');
    },
    parameter(): string {
        return '?';
    },
    countAllExpression(): string {
        return 'count(*)';
    },
    falsePredicate(): string {
        return '0 = 1';
    },
    insertConflictDoNothingClause(): string {
        return 'on conflict do nothing';
    },
};

class DialectRawSqlContext extends RawSqlContext {
    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(RawSqlContext.connection, {
            provider: 'custom',
            dialect: questionMarkDialect,
        });
    }
}

function createDb(connection: RecordingDatabaseConnection): RawSqlContext {
    RawSqlContext.connection = connection;
    return RawSqlContext.create();
}

function createDialectDb(connection: RecordingDatabaseConnection): DialectRawSqlContext {
    RawSqlContext.connection = connection;
    return DialectRawSqlContext.create();
}

describe('raw SQL escape hatch', () => {
    it('keeps standalone SQL tags provider-specific', () => {
        expect(postgresRawSql`select ${1}, ${2}`).toEqual({
            text: 'select $1, $2',
            values: [1, 2],
        });
        expect(sqliteRawSql`select ${1}, ${2}`).toEqual({
            text: 'select ?, ?',
            values: [1, 2],
        });
        expect(mysqlRawSql`select ${1}, ${2}`).toEqual({
            text: 'select ?, ?',
            values: [1, 2],
        });
    });

    it('executes parameterized raw row queries', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rows: [{ id: 'usr_1' }], rowCount: 1 });
        const db =  createDb(connection);

        const rows = await db.database.sql<{ id: string }>`select id from users where email = ${'a@example.com'}`;

        expect(rows).toEqual([{ id: 'usr_1' }]);
        expect(connection.statements[0]).toEqual({
            text: 'select id from users where email = $1',
            values: ['a@example.com'],
        });
    });

    it('executes parameterized raw commands and returns affected rows', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 2 });
        const db =  createDb(connection);

        const affected = await db.database.execute`update users set name = ${'Updated'} where email like ${'%@example.com'}`;

        expect(affected).toBe(2);
        expect(connection.statements[0]).toEqual({
            text: 'update users set name = $1 where email like $2',
            values: ['Updated', '%@example.com'],
        });
    });

    it('executes provider-owned Postgres upsert statements', async () => {
        const createdAt = new Date('2026-01-01T00:00:00.000Z');
        const updatedAt = new Date('2026-01-02T00:00:00.000Z');
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 1 });
        const db =  createDb(connection);

        const affected = await db.database.executeStatement(postgres.upsertStatement(
            db.users,
            new User({ id: 'usr_1', email: 'a@example.com', name: 'A', createdAt, updatedAt }),
            {
                conflict: [user => user.email],
                update: [user => user.name, user => user.updatedAt],
            },
        ));

        expect(affected).toBe(1);
        expect(connection.statements[0]).toEqual({
            text: 'insert into "users" ("id", "email", "name", "created_at", "updated_at") values ($1, $2, $3, $4, $5) on conflict ("email") do update set "name" = excluded."name", "updated_at" = excluded."updated_at"',
            values: ['usr_1', 'a@example.com', 'A', createdAt, updatedAt],
        });
    });

    it('executes provider-owned Postgres set-based update statements', async () => {
        const updatedAt = new Date('2026-01-02T00:00:00.000Z');
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 3 });
        const db =  createDb(connection);

        const affected = await db.database.executeStatement(postgres.updateStatement(db.users, {
            set: { name: 'Updated', updatedAt },
            where: user => user.email.endsWith('@example.com'),
        }));

        expect(affected).toBe(3);
        expect(connection.statements[0]).toEqual({
            text: 'update "users" set "name" = $1, "updated_at" = $2 where "email" like $3 escape \'~\'',
            values: ['Updated', updatedAt, '%@example.com'],
        });
    });

    it('executes provider-owned Postgres set-based delete statements', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 2 });
        const db =  createDb(connection);

        const affected = await db.database.executeStatement(postgres.deleteStatement(db.users, {
            where: user => user.email.endsWith('@example.com'),
        }));

        expect(affected).toBe(2);
        expect(connection.statements[0]).toEqual({
            text: 'delete from "users" where "email" like $1 escape \'~\'',
            values: ['%@example.com'],
        });
    });

    it('validates provider-owned Postgres statement where callbacks', () => {
        const db =  createDb(new RecordingDatabaseConnection());

        expect(() => postgres.updateStatement(db.users, {
            set: { name: 'Updated' },
            where: (() => undefined) as never,
        })).toThrow('Postgres update statements require a where predicate.');

        expect(() => postgres.deleteStatement(db.users, {
            where: (() => undefined) as never,
        })).toThrow('Postgres delete statements require a where predicate.');
    });

    it('materializes unsafe entity SQL without tracking by default', async () => {
        const createdAt = new Date('2026-01-01T00:00:00.000Z');
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({
            rows: [{
                id: 'usr_1',
                email: 'a@example.com',
                name: 'A',
                created_at: createdAt,
                updated_at: createdAt,
            }],
            rowCount: 1,
        });
        const db =  createDb(connection);

        const users = await db.users.fromSqlUnsafe`select id, email, name, created_at, updated_at from users where id = ${'usr_1'}`.toArray();
        const user = users[0];

        expect(user).toBeInstanceOf(User);
        expect(user.email).toBe('a@example.com');
        expect(db.entry(user)).toBeUndefined();
        expect(connection.statements[0]?.values).toEqual(['usr_1']);
    });

    it('tracks unsafe entity SQL only after an explicit opt-in', async () => {
        const createdAt = new Date('2026-01-01T00:00:00.000Z');
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        connection.queueResult({
            rows: [{
                id: 'usr_1',
                email: 'a@example.com',
                name: 'A',
                created_at: createdAt,
                updated_at: createdAt,
            }],
            rowCount: 1,
        });
        const users = await db.users
            .fromSqlUnsafe`select * from users where id = ${'usr_1'}`
            .asTracking()
            .toArray();

        expect(db.entry(users[0])?.state).toBe(EntityState.Unchanged);
    });

    it('can preview raw SQL statements', () => {
        const db =  createDb(new RecordingDatabaseConnection());

        const statement = db.database.rawSql`select * from users where id = ${'usr_1'}`;
        const query = db.users.fromSqlUnsafe`select * from users where id = ${'usr_1'}`;

        expect(statement).toEqual({ text: 'select * from users where id = $1', values: ['usr_1'] });
        expect(query.toDebugSql()).toBe(
            'select * from users where id = $1 -- parameters: [<redacted:string>]',
        );
        expect(query.toDebugSql({ includeSensitiveData: true })).toBe(
            'select * from users where id = $1 -- parameters: ["usr_1"]',
        );
        expect('fromSql' in db.users).toBe(false);
        expect('first' in query).toBe(false);
        expect('single' in query).toBe(false);
    });

    it('formats unusual sensitive debug values without throwing', () => {
        const db = createDb(new RecordingDatabaseConnection());
        const circular: { self?: unknown } = {};
        circular.self = circular;
        const query = db.users.fromSqlUnsafe`select ${42n}, ${new Date('2026-01-01T00:00:00.000Z')}, ${new Uint8Array([0, 1, 255])}, ${circular}`;

        expect(query.toDebugSql()).toBe(
            'select $1, $2, $3, $4 -- parameters: [<redacted:bigint>, <redacted:date>, <redacted:bytes>, <redacted:object>]',
        );
        expect(query.toDebugSql({ includeSensitiveData: true })).toBe(
            'select $1, $2, $3, $4 -- parameters: [42n, Date("2026-01-01T00:00:00.000Z"), Uint8Array(length=3, hex=0001ff), {"self": [Circular]}]',
        );
    });

    it('uses the configured dialect for context raw SQL templates', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rows: [{ id: 'usr_1' }], rowCount: 1 });
        connection.queueResult({ rowCount: 2 });
        const db =  createDialectDb(connection);

        const statement = db.database.rawSql`select * from users where id = ${'usr_1'}`;
        const rows = await db.database.sql<{ id: string }>`select id from users where email = ${'a@example.com'}`;
        const affected = await db.database.execute`update users set name = ${'Updated'} where email like ${'%@example.com'}`;

        expect(statement).toEqual({ text: 'select * from users where id = ?', values: ['usr_1'] });
        expect(rows).toEqual([{ id: 'usr_1' }]);
        expect(affected).toBe(2);
        expect(connection.statements.map(item => item.text)).toEqual([
            'select id from users where email = ?',
            'update users set name = ? where email like ?',
        ]);
    });

    it('preserves raw SQL interpolation order with repeated and null values', () => {
        const db =  createDialectDb(new RecordingDatabaseConnection());
        const repeated = 'usr_1';

        expect(db.database.rawSql`select * from users where id = ${repeated} or manager_id = ${repeated} or deleted_at is ${null}`).toEqual({
            text: 'select * from users where id = ? or manager_id = ? or deleted_at is ?',
            values: ['usr_1', 'usr_1', null],
        });
    });

    it('uses the configured dialect for DbSet raw SQL templates', async () => {
        const createdAt = new Date('2026-01-01T00:00:00.000Z');
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({
            rows: [{
                id: 'usr_1',
                email: 'a@example.com',
                name: 'A',
                created_at: createdAt,
                updated_at: createdAt,
            }],
            rowCount: 1,
        });
        const db =  createDialectDb(connection);

        const query = db.users.fromSqlUnsafe`select id, email, name, created_at, updated_at from users where id = ${'usr_1'}`;
        const users = await query.toArray();

        expect(users[0]?.email).toBe('a@example.com');
        expect(query.toSql()).toEqual({
            text: 'select id, email, name, created_at, updated_at from users where id = ?',
            values: ['usr_1'],
        });
        expect(connection.statements[0]?.text).toBe('select id, email, name, created_at, updated_at from users where id = ?');
    });
});
