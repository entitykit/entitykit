import { RecordingDatabaseConnection } from '../support/recording-database-connection';
import { AppDbContext, createDb, createScopedDb } from './support';

describe('left joined projection queries', () => {
    afterEach(() => {
        AppDbContext.dialect = undefined;
    });

    it('renders left joined projection SQL with nullable optional-side fields', () => {
        const db =  createDb();

        expect(db.posts
            .leftJoin('author', db.authors, ({ root, author }) => root.authorId.eq(author.id))
            .select(({ root, author }) => ({
                postId: root.id,
                title: root.title,
                authorEmail: author.email,
            }))
            .toSql()).toEqual({
            text: 'select "root"."id" as "postId", "root"."title" as "title", "author"."email" as "authorEmail" from "blog_posts" "root" left join "authors" "author" on "root"."author_id" = "author"."id"',
            values: [],
        });
    });

    it('materializes missing left-joined rows as null projection values', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        connection.queueResult({
            rows: [{
                postId: 'post_orphaned',
                title: 'Missing optional relation',
                authorEmail: null,
                authorStatus: null,
            }],
            rowCount: 1,
        });

        const rows = await db.posts
            .leftJoin('author', db.authors, ({ root, author }) => root.authorId.eq(author.id))
            .select(({ root, author }) => ({
                postId: root.id,
                title: root.title,
                authorEmail: author.email,
                authorStatus: author.status,
            }))
            .toArray();

        expect(rows).toEqual([{
            postId: 'post_orphaned',
            title: 'Missing optional relation',
            authorEmail: null,
            authorStatus: null,
        }]);
        expect(db.changeTracker.entries()).toHaveLength(0);
    });

    it('keeps nullable joined fields nested and supports fallbacks', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = createDb(connection);
        connection.queueResult({
            rows: [{
                postId: 'post_orphaned',
                __entitykit_projection_0: null,
                __entitykit_projection_1: null,
                authorLabel: 'unknown',
            }],
            rowCount: 1,
        });

        const rows = await db.posts
            .leftJoin(
                'author',
                db.authors,
                ({ root, author }) => root.authorId.eq(author.id),
            )
            .select(({ root, author }, sql) => ({
                postId: root.id,
                author: {
                    email: author.email,
                    status: author.status,
                },
                authorLabel: sql.coalesce(
                    author.email,
                    sql.literal('unknown'),
                ),
            }))
            .toArray();

        expect(rows).toEqual([{
            postId: 'post_orphaned',
            author: { email: null, status: null },
            authorLabel: 'unknown',
        }]);
        expect(connection.statements[0]).toEqual({
            text: 'select "root"."id" as "postId", "author"."email" as "__entitykit_projection_0", "author"."status" as "__entitykit_projection_1", coalesce("author"."email", $1) as "authorLabel" from "blog_posts" "root" left join "authors" "author" on "root"."author_id" = "author"."id"',
            values: ['unknown'],
        });
    });

    it('keeps explicit where predicates on left-joined aliases in the where clause', () => {
        const db =  createDb();

        expect(db.posts
            .leftJoin('author', db.authors, ({ root, author }) => root.authorId.eq(author.id))
            .select(({ root, author }) => ({
                postId: root.id,
                authorEmail: author.email,
            }))
            .where(({ author }) => author.email.endsWith('@example.com'))
            .toSql()).toEqual({
            text: 'select "root"."id" as "postId", "author"."email" as "authorEmail" from "blog_posts" "root" left join "authors" "author" on "root"."author_id" = "author"."id" where "author"."email" like $1 escape \'~\'',
            values: ['%@example.com'],
        });
    });

    it('applies joined source query filters in the left join predicate', () => {
        const db =  createScopedDb();

        expect(db.posts
            .leftJoin('author', db.authors, ({ root, author }) => root.authorId.eq(author.id))
            .select(({ root, author }) => ({
                postId: root.id,
                authorEmail: author.email,
            }))
            .toSql()).toEqual({
            text: 'select "root"."id" as "postId", "author"."email" as "authorEmail" from "scoped_posts" "root" left join "scoped_authors" "author" on (("root"."author_id" = "author"."id" and "author"."deleted_at" is null) and "author"."workspace_id" = $1) where ("root"."deleted_at" is null and "root"."workspace_id" = $2)',
            values: ['wrk_1', 'wrk_1'],
        });
    });
});
