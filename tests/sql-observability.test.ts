import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext, EntityState } from '../packages/core/src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class User {
    public id!: string;
    public email!: string;
    public name!: string;

    constructor(data?: Partial<User>) {
        Object.assign(this, data);
    }
}

class AppDbContext extends DbContext {
    public static connection: RecordingDatabaseConnection;
    public users = this.set(User);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(AppDbContext.connection);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(User, entity => {
            entity.toTable('users');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(user => user.email).hasColumnName('email').hasColumnType('text').isRequired();
            entity.property(user => user.name).hasColumnName('name').hasColumnType('text').isRequired();
        });
    }
}

function createDb(): AppDbContext {
    AppDbContext.connection = new RecordingDatabaseConnection();
    return AppDbContext.create();
}

describe('SQL observability', () => {
    it('previews generated query SQL without executing it', () => {
        const db =  createDb();

        const query = db.users
            .where(user => user.email.like('%@example.com'))
            .orderBy(user => user.name)
            .take(5);

        expect(query.toSql()).toEqual({
            text: 'select "id", "email", "name" from "users" where "email" like $1 order by "name" asc limit $2',
            values: ['%@example.com', 5],
        });
        expect(query.toDebugSql()).toBe('select "id", "email", "name" from "users" where "email" like $1 order by "name" asc limit $2 -- parameters: [<redacted:string>, <redacted:number>]');
        expect(query.toDebugSql({ includeSensitiveData: true })).toBe('select "id", "email", "name" from "users" where "email" like $1 order by "name" asc limit $2 -- parameters: ["%@example.com", 5]');
        expect(query.toPlan()).toEqual({
            schemaVersion: 1,
            entityName: 'User',
            tracking: 'track',
            hasPredicate: true,
            orderings: 1,
            includes: [],
            joins: [],
            relationPredicates: 0,
            projectionFields: 0,
            groupKeys: 0,
            aggregateFields: 0,
            hasHaving: false,
            offset: null,
            limit: 5,
            ignoresQueryFilters: false,
            ignoresTenantScope: false,
        });
        expect(JSON.parse(JSON.stringify(query.toPlan())))
            .toEqual(query.toPlan());
        expect(AppDbContext.connection.statements).toHaveLength(0);
    });

    it('previews save plans without committing changes', () => {
        const db =  createDb();
        const user = new User({ id: 'usr_1', email: 'a@example.com', name: 'A' });

        db.users.attach(user);
        user.name = 'B';

        const plan = db.getSavePlan();

        expect(plan).toHaveLength(1);
        expect(plan[0]).toMatchObject({
            entityName: 'User',
            keyValue: 'usr_1',
            state: EntityState.Modified,
            statement: {
                text: 'update "users" set "name" = $1 where "id" = $2',
                values: ['B', 'usr_1'],
            },
        });
        expect(db.getSavePlanDebugView()).toContain('update "users" set "name" = $1 where "id" = $2');
        expect(AppDbContext.connection.statements).toHaveLength(0);
    });
});
