import type {
    DbContextOptionsBuilder,
    ModelBuilder,
    ProjectedQueryable,
    ValueConverter,
} from '../src';
import type { SqlDialect } from '../src/adapter';
import { DbContext, enumString } from '../src';
import { mySqlDialect } from '../src/providers/mysql';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

type UserStatus = 'active' | 'disabled';

const prefixedConverter: ValueConverter<string, string> = {
    toProvider: value => `db:${value}`,
    fromProvider: value => {
        if (!value.startsWith('db:')) {
            throw new Error(`Expected prefixed provider value, received '${value}'.`);
        }
        return value.slice(3);
    },
};

class User {
    public id!: string;
    public email!: string;
    public status!: UserStatus;
    public createdAt!: Date;
    public firstName!: string;
    public lastName!: string;
    public nickname!: string | null;
    public loginCount!: number;
    public convertedLabel!: string | null;

    constructor(data?: Partial<User>) {
        Object.assign(this, data);
    }
}

class AppDbContext extends DbContext {
    public static connection: RecordingDatabaseConnection;
    public static dialect: SqlDialect | undefined;
    public users = this.set(User);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(AppDbContext.connection, {
            dialect: AppDbContext.dialect,
        });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(User, entity => {
            entity.toTable('users');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(user => user.email).hasColumnName('email').hasColumnType('text').isRequired();
            entity.property(user => user.status).hasColumnName('status').hasColumnType('text').hasConversion(enumString<UserStatus>()).isRequired();
            entity.property(user => user.createdAt).hasColumnName('created_at').hasColumnType('timestamptz').isRequired();
            entity.property(user => user.firstName).hasColumnName('first_name').hasColumnType('text').isRequired();
            entity.property(user => user.lastName).hasColumnName('last_name').hasColumnType('text').isRequired();
            entity.property(user => user.nickname).hasColumnName('nickname').hasColumnType('text');
            entity.property(user => user.loginCount).hasColumnName('login_count').hasColumnType('integer').isRequired();
            entity.property(user => user.convertedLabel)
                .hasColumnName('converted_label').hasColumnType('text')
                .hasConversion(prefixedConverter);
        });
    }
}

function createDb(
    connection = new RecordingDatabaseConnection(),
    dialect?: SqlDialect,
): AppDbContext {
    AppDbContext.connection = connection;
    AppDbContext.dialect = dialect;
    return AppDbContext.create();
}

describe('projection queries', () => {
    it('selects mapped columns with aliases and returns untracked projection objects', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        connection.queueResult({
            rows: [{ userId: 'usr_1', email: 'a@example.com', status: 'active' }],
            rowCount: 1,
        });

        const rows = await db.users
            .where(user => user.status.eq('active'))
            .orderBy(user => user.email)
            .select(user => ({
                userId: user.id,
                email: user.email,
                status: user.status,
            }))
            .toArray();

        expect(connection.statements).toEqual([{ text: 'select "id" as "userId", "email" as "email", "status" as "status" from "users" where "status" = $1 order by "email" asc', values: ['active'] }]);
        expect(rows).toEqual([{ userId: 'usr_1', email: 'a@example.com', status: 'active' }]);
        expect(db.changeTracker.entries()).toHaveLength(0);
    });

    it('supports first and single projection semantics', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);

        connection.queueResult({ rows: [{ email: 'a@example.com' }], rowCount: 1 });
        await expect(db.users.select(user => ({ email: user.email })).firstOrNull()).resolves.toEqual({ email: 'a@example.com' });

        connection.queueResult({ rows: [], rowCount: 0 });
        await expect(db.users.select(user => ({ email: user.email })).single()).rejects.toThrow('No \'User\' projection matched');

        connection.queueResult({ rows: [{ email: 'a@example.com' }, { email: 'b@example.com' }], rowCount: 2 });
        await expect(db.users.select(user => ({ email: user.email })).single()).rejects.toThrow('More than one \'User\' projection matched');
    });

    it('renders projection SQL before execution', () => {
        const db =  createDb();

        expect(db.users
            .where(user => user.email.like('%@example.com'))
            .take(2)
            .select(user => ({ id: user.id, email: user.email }))
            .toSql()).toEqual({
            text: 'select "id" as "id", "email" as "email" from "users" where "email" like $1 limit $2',
            values: ['%@example.com', 2],
        });
    });

    it('selects literal projection values with stable parameter order', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        connection.queueResult({
            rows: [{ kind: 'user', priority: 5, isActive: true, id: 'usr_1' }],
            rowCount: 1,
        });

        const rows = await db.users
            .where(user => user.status.eq('active'))
            .take(2)
            .select((user, project) => ({
                kind: project.literal('user'),
                priority: project.literal(5),
                isActive: project.literal(true),
                id: user.id,
            }))
            .toArray();

        expect(connection.statements).toEqual([{
            text: 'select $1 as "kind", $2 as "priority", $3 as "isActive", "id" as "id" from "users" where "status" = $4 limit $5',
            values: ['user', 5, true, 'active', 2],
        }]);
        expect(rows).toEqual([{ kind: 'user', priority: 5, isActive: true, id: 'usr_1' }]);
        expect(db.changeTracker.entries()).toHaveLength(0);
    });

    it('materializes typed SQL expressions into nested read models', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = createDb(connection);
        connection.queueResult({
            rows: [{
                id: 'usr_1',
                __entitykit_projection_0: 'ADA Lovelace',
                __entitykit_projection_1: 'ada@example.com',
                __entitykit_projection_2: 'anonymous',
                __entitykit_projection_3: '42',
                __entitykit_projection_4: '1',
                emailLength: '15',
            }],
            rowCount: 1,
        });

        const rows = await db.users
            .where(user => user.status.eq('active'))
            .select((user, sql) => ({
                id: user.id,
                profile: {
                    displayName: sql.concat(
                        sql.upper(user.firstName),
                        sql.literal(' '),
                        user.lastName,
                    ),
                    normalizedEmail: sql.lower(user.email),
                    nickname: sql.coalesce(
                        user.nickname,
                        sql.literal('anonymous'),
                    ),
                },
                metrics: {
                    nextLogin: sql.add(
                        user.loginCount,
                        sql.literal(1),
                    ),
                    parity: sql.modulo(
                        user.loginCount,
                        sql.literal(2),
                    ),
                },
                emailLength: sql.length(user.email),
            }))
            .take(1)
            .toArray();

        const typed: ReadonlyArray<{
            readonly id: string;
            readonly profile: {
                readonly displayName: string;
                readonly normalizedEmail: string;
                readonly nickname: string;
            };
            readonly metrics: {
                readonly nextLogin: number;
                readonly parity: number;
            };
            readonly emailLength: number;
        }> = rows;
        expect(typed).toEqual([{
            id: 'usr_1',
            profile: {
                displayName: 'ADA Lovelace',
                normalizedEmail: 'ada@example.com',
                nickname: 'anonymous',
            },
            metrics: { nextLogin: 42, parity: 1 },
            emailLength: 15,
        }]);
        expect(connection.statements).toEqual([{
            text: 'select "id" as "id", (upper("first_name") || $1 || "last_name") as "__entitykit_projection_0", lower("email") as "__entitykit_projection_1", coalesce("nickname", $2) as "__entitykit_projection_2", ("login_count" + $3) as "__entitykit_projection_3", ("login_count" % $4) as "__entitykit_projection_4", length("email") as "emailLength" from "users" where "status" = $5 limit $6',
            values: [' ', 'anonymous', 1, 2, 'active', 1],
        }]);
    });

    it('materializes __proto__ as an own nested projection without changing Object.prototype', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = createDb(connection);
        connection.queueResult({
            rows: [{ __entitykit_projection_0: 'usr_1' }],
            rowCount: 1,
        });
        const pollutedProperty = '__entitykitProjectionPolluted';

        try {
            const row = await db.users
                .select(user => ({
                    ['__proto__']: {
                        [pollutedProperty]: user.id,
                    },
                }))
                .single();

            expect(Object.prototype).not.toHaveProperty(pollutedProperty);
            expect(Object.prototype.hasOwnProperty.call(row, '__proto__'))
                .toBe(true);
            expect(row).toEqual({
                ['__proto__']: { [pollutedProperty]: 'usr_1' },
            });
        } finally {
            Reflect.deleteProperty(Object.prototype, pollutedProperty);
        }
    });

    it('converts coalesce fallback literals on initial and cached executions', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = createDb(connection);
        connection.queueResult({
            rows: [{ label: 'db:first' }],
            rowCount: 1,
        });
        connection.queueResult({
            rows: [{ label: 'db:second' }],
            rowCount: 1,
        });
        const query = (
            fallback: string,
        ): ProjectedQueryable<User, { label: string }> =>
            db.users.select((user, sql) => ({
                label: sql.coalesce(
                    user.convertedLabel,
                    sql.literal(fallback),
                ),
            }));

        await expect(query('first').single()).resolves.toEqual({
            label: 'first',
        });
        await expect(query('second').single()).resolves.toEqual({
            label: 'second',
        });
        expect(connection.statements).toEqual([{
            text: 'select coalesce("converted_label", $1) as "label" from "users" limit $2',
            values: ['db:first', 2],
        }, {
            text: 'select coalesce("converted_label", $1) as "label" from "users" limit $2',
            values: ['db:second', 2],
        }]);
    });

    it('uses provider-specific text expression spelling', () => {
        const db = createDb(new RecordingDatabaseConnection(), mySqlDialect);
        const query = db.users.select((user, sql) => ({
            displayName: sql.concat(
                user.firstName,
                sql.literal(' '),
                user.lastName,
            ),
            emailLength: sql.length(user.email),
        }));
        const statement = query.toSql();

        expect(statement).toEqual({
            text: 'select concat(`first_name`, ?, `last_name`) as `displayName`, char_length(`email`) as `emailLength` from `users`',
            values: [' '],
        });
    });

    it('rejects empty and non-object nested shapes', () => {
        const db = createDb();
        expect(() => db.users.select(user => ({
            id: user.id,
            profile: {},
        }))).toThrow(
            'Projection path \'profile\' must select at least one value.',
        );
        expect(() => db.users.select(user => ({
            id: user.id,
            profile: [] as never,
        }))).toThrow(
            'Projection path \'profile\' must select a mapped field, literal, SQL expression, or plain nested object.',
        );
    });
});
