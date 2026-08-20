import type {
    DbContextOptionsBuilder,
    ModelBuilder,
} from '../../packages/core/src';
import {
    DbContext,
} from '../../packages/core/src';

/**
 * Grouped-aggregate `orderBy` places a null group key SQL-standard on every
 * provider.
 *
 * `aggregateOrderByColumns` built its `order by` term without the dialect's
 * null-ordering hook, so `groupBy(nullableCol).orderBy(g => g.key.col)` put the
 * null-keyed group first on SQLite and MySQL (their raw default) but last on
 * Postgres — the same query, a different group order per provider. It now runs
 * through the same hooks as the row path, so nulls sort high (last ascending,
 * first descending) everywhere.
 *
 * SQLite runs in-process (unconditional); Postgres and MySQL are gated on their
 * integration env.
 */
class Member {
    public id!: string;
    public team!: string | null;
    public score!: number;
}

class OrgContext extends DbContext {
    public static configureProvider: (options: DbContextOptionsBuilder) => void;

    public members = this.set(Member);

    protected override configure(options: DbContextOptionsBuilder): void {
        OrgContext.configureProvider(options);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Member, entity => {
            entity.toTable('ano_members');
            entity.hasKey(m => m.id);
            entity.property(m => m.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(m => m.team).hasColumnName('team').hasColumnType('text');
            entity.property(m => m.score).hasColumnName('score').hasColumnType('integer').isRequired();
        });
    }
}

function defineTests(label: string, configure: (options: DbContextOptionsBuilder) => void): void {
    describe(`grouped-aggregate null ordering (${label})`, () => {
        let db: OrgContext;

        beforeEach(async () => {
            OrgContext.configureProvider = configure;
            db =  OrgContext.create();
            await db.database.connection.query({ text: 'drop table if exists ano_members', values: [] });
            for (const statement of db.database.createScript().split(';').map(s => s.trim()).filter(Boolean)) {
                await db.database.connection.query({ text: statement, values: [] });
            }
            db.members.add(Object.assign(new Member(), { id: 'm1', team: 'west', score: 10 }));
            db.members.add(Object.assign(new Member(), { id: 'm2', team: 'east', score: 20 }));
            db.members.add(Object.assign(new Member(), { id: 'm3', team: null, score: 30 }));
            db.members.add(Object.assign(new Member(), { id: 'm4', team: null, score: 5 }));
            await db.saveChanges();
            db.changeTracker.clear();
        });

        afterEach(async () => {
            await db.database.connection.query({ text: 'drop table if exists ano_members', values: [] });
            await db.dispose();
        });

        it('sorts the null-keyed group last ascending', async () => {
            const rows = await db.members
                .groupBy(m => ({ team: m.team }))
                .orderBy(g => g.key.team)
                .select(g => ({ team: g.key.team, count: g.count() }))
                .toArray();
            expect(rows.map(r => r.team)).toEqual(['east', 'west', null]);
        });

        it('sorts the null-keyed group first descending', async () => {
            const rows = await db.members
                .groupBy(m => ({ team: m.team }))
                .orderByDescending(g => g.key.team)
                .select(g => ({ team: g.key.team, count: g.count() }))
                .toArray();
            expect(rows.map(r => r.team)).toEqual([null, 'west', 'east']);
        });
    });
}

defineTests('SQLite', options => options.useSqlite(':memory:'));

const postgresUrl = process.env.DATABASE_URL;
if (process.env.RUN_POSTGRES_TESTS === 'true' && postgresUrl) {
    defineTests('Postgres', options => options.usePostgres(postgresUrl));
}

const mysqlUrl = process.env.MYSQL_URL ?? process.env.MYSQL_DATABASE_URL;
if (process.env.RUN_MYSQL_TESTS === 'true' && mysqlUrl) {
    defineTests('MySQL', options => options.useMySql(mysqlUrl));
}
