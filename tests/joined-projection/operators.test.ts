import { RecordingDatabaseConnection } from '../support/recording-database-connection';
import { AppDbContext, createDb } from './support';

describe('joined projection operators and cardinality', () => {
    afterEach(() => {
        AppDbContext.dialect = undefined;
    });

    it('supports joined where ordering and paging before projection', () => {
        const db =  createDb();

        expect(db.posts
            .join('author', db.authors, ({ root, author }) => root.authorId.eq(author.id))
            .where(({ root, author }) => root.title.contains('EntityKit').and(author.status.eq('active')))
            .whereIf(false, ({ author }) => author.email.eq('nobody@example.com'))
            .orderBy(({ author }) => author.email)
            .orderByDescending(({ root }) => root.createdAt)
            .skip(10)
            .take(5)
            .select(({ root, author }) => ({
                postId: root.id,
                authorEmail: author.email,
            }))
            .toSql()).toEqual({
            text: 'select "root"."id" as "postId", "author"."email" as "authorEmail" from "blog_posts" "root" inner join "authors" "author" on "root"."author_id" = "author"."id" where ("root"."title" like $1 escape \'~\' and "author"."status" = $2) order by "author"."email" asc, "root"."created_at" desc limit $3 offset $4',
            values: ['%EntityKit%', 'active', 5, 10],
        });
    });

    it('supports joined operators after projection', () => {
        const db =  createDb();

        expect(db.posts
            .join('author', db.authors, ({ root, author }) => root.authorId.eq(author.id))
            .select(({ root, author }) => ({
                postId: root.id,
                authorEmail: author.email,
            }))
            .where(({ author }) => author.email.endsWith('@example.com'))
            .orderByDescending(({ author }) => author.email)
            .take(2)
            .toSql()).toEqual({
            text: 'select "root"."id" as "postId", "author"."email" as "authorEmail" from "blog_posts" "root" inner join "authors" "author" on "root"."author_id" = "author"."id" where "author"."email" like $1 escape \'~\' order by "author"."email" desc limit $2',
            values: ['%@example.com', 2],
        });
    });

    it('supports joined projection cardinality helpers', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        connection.queueResult({ rows: [{ count: 3 }], rowCount: 1 });
        connection.queueResult({ rows: [{ exists: true }], rowCount: 1 });

        const query = db.posts
            .join('author', db.authors, ({ root, author }) => root.authorId.eq(author.id))
            .select(({ root, author }) => ({
                postId: root.id,
                authorEmail: author.email,
            }))
            .where(({ author }) => author.status.eq('active'));

        await expect(query.count()).resolves.toBe(3);
        await expect(query.exists()).resolves.toBe(true);

        expect(connection.statements).toEqual([
            {
                text: 'select count(*) as "count" from "blog_posts" "root" inner join "authors" "author" on "root"."author_id" = "author"."id" where "author"."status" = $1',
                values: ['active'],
            },
            {
                text: 'select exists(select 1 from "blog_posts" "root" inner join "authors" "author" on "root"."author_id" = "author"."id" where "author"."status" = $1 limit 1) as "exists"',
                values: ['active'],
            },
        ]);
    });

    it('uses projection error semantics for joined first and single helpers', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        connection.queueResult({ rows: [{ postId: 'post_1', authorEmail: 'author@example.com' }], rowCount: 1 });
        connection.queueResult({ rows: [], rowCount: 0 });
        connection.queueResult({
            rows: [
                { postId: 'post_1', authorEmail: 'a@example.com' },
                { postId: 'post_2', authorEmail: 'b@example.com' },
            ],
            rowCount: 2,
        });

        const query = db.posts
            .join('author', db.authors, ({ root, author }) => root.authorId.eq(author.id))
            .select(({ root, author }) => ({
                postId: root.id,
                authorEmail: author.email,
            }));

        await expect(query.firstOrNull()).resolves.toEqual({ postId: 'post_1', authorEmail: 'author@example.com' });
        await expect(query.single()).rejects.toThrow('No \'BlogPost\' projection matched');
        await expect(query.single()).rejects.toThrow('More than one \'BlogPost\' projection matched');

        expect(connection.statements.map(statement => statement.text)).toEqual([
            'select "root"."id" as "postId", "author"."email" as "authorEmail" from "blog_posts" "root" inner join "authors" "author" on "root"."author_id" = "author"."id" limit $1',
            'select "root"."id" as "postId", "author"."email" as "authorEmail" from "blog_posts" "root" inner join "authors" "author" on "root"."author_id" = "author"."id" limit $1',
            'select "root"."id" as "postId", "author"."email" as "authorEmail" from "blog_posts" "root" inner join "authors" "author" on "root"."author_id" = "author"."id" limit $1',
        ]);
        expect(connection.statements.map(statement => statement.values)).toEqual([[1], [2], [2]]);
    });
});
