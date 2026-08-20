import { postgres } from '../../packages/postgres/src';
import { RecordingDatabaseConnection } from '../support/recording-database-connection';
import { AppDbContext, createDb, createScopedDb } from './support';

describe('joined aggregate projection queries', () => {
    afterEach(() => {
        AppDbContext.dialect = undefined;
    });

    it('renders ungrouped joined aggregate SQL with qualified source aliases', () => {
        const db =  createDb();

        expect(db.posts
            .join('author', db.authors, ({ root, author }) => root.authorId.eq(author.id))
            .where(({ author }) => author.status.eq('active'))
            .aggregate(agg => ({
                postCount: agg.count(),
                authorCount: agg.count(({ author }) => author.id),
                latestPostAt: agg.max(({ root }) => root.createdAt),
            }))
            .toSql()).toEqual({
            text: 'select count(*)::int as "postCount", count("author"."id") as "authorCount", max("root"."created_at") as "latestPostAt" from "blog_posts" "root" inner join "authors" "author" on "root"."author_id" = "author"."id" where "author"."status" = $1',
            values: ['active'],
        });
    });

    it('renders grouped joined aggregate SQL with having ordering and paging', () => {
        const db =  createDb();

        expect(db.posts
            .join('author', db.authors, ({ root, author }) => root.authorId.eq(author.id))
            .groupBy(({ author }) => ({ authorStatus: author.status }))
            .having(group => group.sum(({ root }) => root.viewCount).gte(100))
            .orderByDescending(group => group.sum(({ root }) => root.viewCount))
            .orderBy(group => group.key.authorStatus.asc())
            .take(5)
            .select(group => ({
                authorStatus: group.key.authorStatus,
                postCount: group.count(),
                totalViews: group.sum(({ root }) => root.viewCount),
            }))
            .toSql()).toEqual({
            text: 'select "author"."status" as "authorStatus", count(*)::int as "postCount", sum("root"."view_count") as "totalViews" from "blog_posts" "root" inner join "authors" "author" on "root"."author_id" = "author"."id" group by "author"."status" having sum("root"."view_count") >= $1 order by sum("root"."view_count") desc, "author"."status" asc limit $2',
            values: [100, 5],
        });
    });

    it('renders joined aggregate SQL with Postgres date-bucket group keys', () => {
        const db =  createDb();

        expect(db.posts
            .join('author', db.authors, ({ root, author }) => root.authorId.eq(author.id))
            .groupBy(({ root, author }) => ({
                month: postgres.dateBucket('month', root.createdAt, { timeZone: 'UTC' }),
                authorStatus: author.status,
            }))
            .orderBy(group => group.key.month.asc())
            .select(group => ({
                month: group.key.month,
                authorStatus: group.key.authorStatus,
                postCount: group.count(),
                totalViews: group.sum(({ root }) => root.viewCount),
            }))
            .toSql()).toEqual({
            text: 'select date_trunc(\'month\', timezone(\'UTC\', "root"."created_at")) as "month", "author"."status" as "authorStatus", count(*)::int as "postCount", sum("root"."view_count") as "totalViews" from "blog_posts" "root" inner join "authors" "author" on "root"."author_id" = "author"."id" group by date_trunc(\'month\', timezone(\'UTC\', "root"."created_at")), "author"."status" order by date_trunc(\'month\', timezone(\'UTC\', "root"."created_at")) asc',
            values: [],
        });
    });

    it('keeps left joined aggregate query filters in the correct clause', () => {
        const db =  createScopedDb();

        expect(db.posts
            .leftJoin('author', db.authors, ({ root, author }) => root.authorId.eq(author.id))
            .groupBy(({ author }) => ({ authorEmail: author.email }))
            .select(group => ({
                authorEmail: group.key.authorEmail,
                postCount: group.count(),
            }))
            .toSql()).toEqual({
            text: 'select "author"."email" as "authorEmail", count(*)::int as "postCount" from "scoped_posts" "root" left join "scoped_authors" "author" on (("root"."author_id" = "author"."id" and "author"."deleted_at" is null) and "author"."workspace_id" = $1) where ("root"."deleted_at" is null and "root"."workspace_id" = $2) group by "author"."email"',
            values: ['wrk_1', 'wrk_1'],
        });
    });

    it('executes joined aggregate projections as untracked plain rows', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        const latestPostAt = new Date('2026-02-01T00:00:00.000Z');
        connection.queueResult({
            rows: [{
                authorStatus: 'active',
                postCount: '3',
                totalViews: '420',
                latestPostAt,
            }],
            rowCount: 1,
        });

        const rows = await db.posts
            .join('author', db.authors, ({ root, author }) => root.authorId.eq(author.id))
            .groupBy(({ author }) => ({ authorStatus: author.status }))
            .select(group => ({
                authorStatus: group.key.authorStatus,
                postCount: group.count(),
                totalViews: group.sum(({ root }) => root.viewCount),
                latestPostAt: group.max(({ root }) => root.createdAt),
            }))
            .toArray();

        expect(rows).toEqual([{
            authorStatus: 'active',
            postCount: 3,
            totalViews: 420,
            latestPostAt,
        }]);
        expect(connection.statements).toEqual([{
            text: 'select "author"."status" as "authorStatus", count(*)::int as "postCount", sum("root"."view_count") as "totalViews", max("root"."created_at") as "latestPostAt" from "blog_posts" "root" inner join "authors" "author" on "root"."author_id" = "author"."id" group by "author"."status"',
            values: [],
        }]);
        expect(db.changeTracker.entries()).toHaveLength(0);
    });
});
