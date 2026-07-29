import { requireDefined } from './support/require-defined';
import type {
    DatabaseQueryResult,
    DbContextOptionsBuilder,
    ModelBuilder,
} from '../src';
import { DbContext, DeleteBehavior } from '../src';
import { postgresProviderServices } from '../src/providers/postgres';
import { sqliteProviderServices } from '../src/providers/sqlite';

/**
 * Interactions, not operations. The type-surface suite covers every operation against every
 * column shape individually; nothing has driven them combined.
 *
 * Every expectation is computed by hand from the seed data below, so a wrong
 * answer is a wrong answer rather than a snapshot of whatever it does today.
 */
class Team {
    public id!: string;
    public tenantId!: string;
    public name!: string;
    public region!: string;
    public deletedAt!: Date | null;
    public members?: Member[];
    constructor(d?: Partial<Team>) {
        Object.assign(this, d);
    }
}

class Member {
    public id!: string;
    public tenantId!: string;
    public teamId!: string;
    public name!: string;
    public score!: number;
    public bonus!: number | null;
    public deletedAt!: Date | null;
    public team?: Team;
    constructor(d?: Partial<Member>) {
        Object.assign(this, d);
    }
}

let activeProvider: 'postgres' | 'sqlite' = 'sqlite';
let activeConnection = ':memory:';

class ShapeDbContext extends DbContext {
    public teams = this.set(Team);
    public members = this.set(Member);

    protected override configure(o: DbContextOptionsBuilder): void {
        o.useProvider(activeProvider === 'postgres' ? postgresProviderServices : sqliteProviderServices, activeConnection);
        o.useTenantScope(() => 't1');
    }

    protected override model(m: ModelBuilder): void {
        m.entity(Team, e => {
            e.toTable('shape_teams');
            e.hasKey(t => t.id);
            e.property(t => t.id).hasColumnName('id').hasColumnType('text').isRequired();
            e.property(t => t.tenantId).hasColumnName('tenant_id').hasColumnType('text').isRequired();
            e.property(t => t.name).hasColumnName('name').hasColumnType('text').isRequired();
            e.property(t => t.region).hasColumnName('region').hasColumnType('text').isRequired();
            e.property(t => t.deletedAt).hasColumnName('deleted_at').hasColumnType('timestamptz');
            e.tenantKey(t => t.tenantId);
            e.softDelete(t => t.deletedAt);
        });
        m.entity(Member, e => {
            e.toTable('shape_members');
            e.hasKey(x => x.id);
            e.property(x => x.id).hasColumnName('id').hasColumnType('text').isRequired();
            e.property(x => x.tenantId).hasColumnName('tenant_id').hasColumnType('text').isRequired();
            e.property(x => x.teamId).hasColumnName('team_id').hasColumnType('text').isRequired();
            e.property(x => x.name).hasColumnName('name').hasColumnType('text').isRequired();
            e.property(x => x.score).hasColumnName('score').hasColumnType('integer').isRequired();
            e.property(x => x.bonus).hasColumnName('bonus').hasColumnType('integer');
            e.property(x => x.deletedAt).hasColumnName('deleted_at').hasColumnType('timestamptz');
            e.tenantKey(x => x.tenantId);
            e.softDelete(x => x.deletedAt);
            e.hasOne(Team, x => x.team).withMany(t => t.members).hasForeignKey(x => x.teamId).onDelete(DeleteBehavior.Cascade);
        });
    }
}

const shouldRunPostgres = process.env.RUN_POSTGRES_TESTS === 'true' && Boolean(process.env.DATABASE_URL);

/**
 * Seed, all tenant t1 unless stated:
 *   teams:   alpha(east)  beta(east)  gamma(west)   ghost(east, DELETED)  rival(t2)
 *   members: a1 alpha 10 bonus 1 | a2 alpha 20 bonus null | a3 alpha 30 DELETED
 *            b1 beta  40 bonus 4 | b2 beta   5 bonus null
 *            g1 gamma 50 bonus 5
 *            h1 ghost 99 bonus 9        (live member of a deleted team)
 *            r1 rival 77 bonus 7 (t2)
 *
 * Live, in-tenant members by team: alpha [10, 20], beta [40, 5], gamma [50],
 * ghost [99]. Live, in-tenant teams: alpha, beta, gamma.
 */
async function seed(): Promise<ShapeDbContext> {
    const db =  ShapeDbContext.create();
    for (const table of ['shape_members', 'shape_teams']) {
        await db.database.connection.query({ text: `drop table if exists ${table}`, values: [] });
    }
    await db.database.connection.query({ text: 'create table shape_teams (id text primary key, tenant_id text not null, name text not null, region text not null, deleted_at text)', values: [] });
    await db.database.connection.query({ text: 'create table shape_members (id text primary key, tenant_id text not null, team_id text not null, name text not null, score integer not null, bonus integer, deleted_at text)', values: [] });

    const q = async (sql: string): Promise<DatabaseQueryResult> => db.database.connection.query({ text: sql, values: [] });
    await q(`insert into shape_teams (id, tenant_id, name, region, deleted_at) values
    ('alpha','t1','Alpha','east',null),('beta','t1','Beta','east',null),('gamma','t1','Gamma','west',null),
    ('ghost','t1','Ghost','east','2026-01-01T00:00:00.000Z'),('rival','t2','Rival','east',null)`);
    await q(`insert into shape_members (id, tenant_id, team_id, name, score, bonus, deleted_at) values
    ('a1','t1','alpha','A1',10,1,null),('a2','t1','alpha','A2',20,null,null),('a3','t1','alpha','A3',30,3,'2026-01-01T00:00:00.000Z'),
    ('b1','t1','beta','B1',40,4,null),('b2','t1','beta','B2',5,null,null),
    ('g1','t1','gamma','G1',50,5,null),
    ('h1','t1','ghost','H1',99,9,null),
    ('r1','t2','rival','R1',77,7,null)`);
    db.changeTracker.clear();
    return db;
}

const providers: Array<[string, string]> = [['sqlite', ':memory:']];
if (shouldRunPostgres) providers.push(['postgres', requireDefined(process.env.DATABASE_URL)]);

describe('composed query shapes', () => {
    for (const [provider, connection] of providers) {
        it(`answers composed queries correctly on ${provider}`, async () => {
            const attempt = async (label: string, run: () => Promise<unknown>, expected: unknown): Promise<void> => {
                expect({ [label]: await run() }).toEqual({ [label]: expected });
            };
            activeProvider = provider as 'postgres' | 'sqlite';
            activeConnection = connection;
            const db = await seed();

            // 1. Aggregate over a join: only live in-tenant members of live teams.
            //    alpha 10+20, beta 40+5, gamma 50 = 125. Ghost's 99 excluded by the
            //    team's soft delete; rival's 77 by tenant.
            await attempt('join + aggregate sum', async () =>
                (await db.members.join('team', db.teams, ({ root, team }) => root.teamId.eq(team.id))
                    .aggregate(agg => ({ total: agg.sum(({ root }) => root.score) })).firstOrNull())?.total, 125);

            // 2. Group by a joined column, with an aggregate.
            //    east = alpha(30) + beta(45) = 75, west = gamma 50.
            await attempt('groupBy joined column + sum', async () =>
                (await db.members.join('team', db.teams, ({ root, team }) => root.teamId.eq(team.id))
                    .groupBy(({ team }) => ({ region: team.region }))
                    .orderBy(group => group.key.region)
                    .select(group => ({ region: group.key.region, total: group.sum(({ root }) => root.score) }))
                    .toArray()).map(r => [r.region, r.total]), [['east', 75], ['west', 50]]);

            // 3. groupBy + having + orderBy + paging together.
            //    No join here, so a member of the soft-deleted `ghost` team is still
            //    a live member and still counts. Totals: alpha 30, beta 45, gamma 50,
            //    ghost 99. having > 30 keeps beta, gamma, ghost; desc orders them
            //    ghost, gamma, beta; skip 1 drops ghost.
            await attempt('groupBy + having + orderBy desc + skip', async () =>
                (await db.members.groupBy(member => ({ team: member.teamId }))
                    .having(group => group.sum(member => member.score).gt(30))
                    .orderByDescending(group => group.sum(member => member.score))
                    .skip(1)
                    .select(group => ({ team: group.key.team, total: group.sum(member => member.score) }))
                    .toArray()).map(r => [r.team, r.total]), [['gamma', 50], ['beta', 45]]);

            // 4. Relation-existence filter combined with a projection and ordering.
            //    Live teams having a live member scoring > 35: beta(40), gamma(50).
            await attempt('whereHas + projection + orderBy', async () =>
                (await db.teams.whereHas(team => team.members, member => member.score.gt(35))
                    .orderBy(team => team.name)
                    .select(team => ({ name: team.name }))
                    .toArray()).map(r => r.name), ['Beta', 'Gamma']);

            // 5. Nullable aggregate crossed with a group: bonus is null for a2, b2.
            //    alpha 1 (a2 null), beta 4 (b2 null), gamma 5, ghost 9.
            await attempt('groupBy + sum over nullable column', async () =>
                (await db.members.groupBy(member => ({ team: member.teamId }))
                    .orderBy(group => group.key.team)
                    .select(group => ({ team: group.key.team, bonus: group.sum(member => member.bonus) }))
                    .toArray()).map(r => [r.team, r.bonus]), [['alpha', 1], ['beta', 4], ['gamma', 5], ['ghost', 9]]);

            // 6. Include on a query that also orders and pages.
            //    Live teams by name, skip 1 take 1 -> Beta, with its 2 live members.
            await attempt('include + orderBy + skip/take', async () => {
                db.changeTracker.clear();
                const teams = await db.teams.include(team => team.members).orderBy(team => team.name).skip(1).take(1).toArray();
                return teams.map(team => [team.name, (team.members ?? []).length]);
            }, [['Beta', 2]]);

            // 7. Left join must not drop unmatched roots, nor resurrect filtered ones.
            await attempt('leftJoin keeps unmatched roots', async () => {
                const rows = await db.teams.leftJoin('m', db.members, ({ root, m }) => root.id.eq(m.teamId))
                    .select(({ root }) => ({ team: root.name }))
                    .toArray();
                return [...new Set(rows.map(r => r.team))].sort();
            }, ['Alpha', 'Beta', 'Gamma']);

            // 8. Join + groupBy + having + paging at once.
            //    alpha 30, beta 45, gamma 50. having > 40 -> beta, gamma. take 1 by name.
            await attempt('join + groupBy + having + take', async () =>
                (await db.members.join('team', db.teams, ({ root, team }) => root.teamId.eq(team.id))
                    .groupBy(({ team }) => ({ team: team.name }))
                    .having(group => group.sum(({ root }) => root.score).gt(40))
                    .orderBy(group => group.key.team)
                    .take(1)
                    .select(group => ({ team: group.key.team, total: group.sum(({ root }) => root.score) }))
                    .toArray()).map(r => [r.team, r.total]), [['Beta', 45]]);

            // 9. Counting through a join. There is no count() on a joined query --
            //     JoinedQueryable has no terminal read operations at all -- so this
            //     has to go through an aggregate. 5 live in-tenant members on live teams.
            await attempt('join + count', async () =>
                await db.members.join('team', db.teams, ({ root, team }) => root.teamId.eq(team.id)).count(), 5);
            await attempt('join + any', async () =>
                await db.members.join('team', db.teams, ({ root, team }) => root.teamId.eq(team.id)).exists(), true);

            // 10. Crossing tenants explicitly must keep soft delete applied.
            //     Adds rival's 77 -> 202. Ghost's 99 still excluded.
            await attempt('ignoreTenantScope + join + aggregate', async () =>
                (await db.members.ignoreTenantScope()
                    .join('team', db.teams, ({ root, team }) => root.teamId.eq(team.id))
                    .aggregate(agg => ({ total: agg.sum(({ root }) => root.score) })).firstOrNull())?.total, 202);

            await db.dispose();
        }, 180000);
    }
});
