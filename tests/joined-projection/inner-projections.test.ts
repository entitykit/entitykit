import type { SqlDialect } from '../../src/adapter';
import { RecordingDatabaseConnection } from '../support/recording-database-connection';
import { AppDbContext, createDb } from './support';

describe('inner joined projection queries', () => {
    afterEach(() => {
        AppDbContext.dialect = undefined;
    });

    it('renders inner joined projection SQL with qualified aliases', () => {
        const db =  createDb();

        expect(db.posts
            .join('author', db.authors, ({ root, author }) => root.authorId.eq(author.id))
            .select(({ root, author }) => ({
                postId: root.id,
                title: root.title,
                authorEmail: author.email,
            }))
            .toSql()).toEqual({
            text: 'select "root"."id" as "postId", "root"."title" as "title", "author"."email" as "authorEmail" from "blog_posts" "root" inner join "authors" "author" on "root"."author_id" = "author"."id"',
            values: [],
        });
    });

    it('executes joined projections as untracked plain rows', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        connection.queueResult({
            rows: [{
                postId: 'post_1',
                title: 'Joined projections',
                authorEmail: 'author@example.com',
                authorStatus: 'active',
            }],
            rowCount: 1,
        });

        const rows = await db.posts
            .join('author', db.authors, ({ root, author }) => root.authorId.eq(author.id).and(author.status.eq('active')))
            .select(({ root, author }) => ({
                postId: root.id,
                title: root.title,
                authorEmail: author.email,
                authorStatus: author.status,
            }))
            .toArray();

        expect(connection.statements).toEqual([{
            text: 'select "root"."id" as "postId", "root"."title" as "title", "author"."email" as "authorEmail", "author"."status" as "authorStatus" from "blog_posts" "root" inner join "authors" "author" on ("root"."author_id" = "author"."id" and "author"."status" = $1)',
            values: ['active'],
        }]);
        expect(rows).toEqual([{
            postId: 'post_1',
            title: 'Joined projections',
            authorEmail: 'author@example.com',
            authorStatus: 'active',
        }]);
        expect(db.changeTracker.entries()).toHaveLength(0);
    });

    it('uses the configured SQL dialect for joined projection placeholders', () => {
        const dialect: SqlDialect = {
            name: 'joined-test',
            quoteIdentifier: identifier => `[${identifier}]`,
            quoteQualifiedIdentifier: (...identifiers) => identifiers.filter(Boolean).map(identifier => `[${String(identifier)}]`).join('.'),
            parameter: () => '?',
            countAllExpression: () => 'count(*)',
            falsePredicate: () => '0 = 1',
            insertConflictDoNothingClause: () => 'on conflict do nothing',
        };
        const db =  createDb(new RecordingDatabaseConnection(), dialect);

        expect(db.posts
            .join('author', db.authors, ({ root, author }) => root.authorId.eq(author.id).and(author.email.contains('@example.com')))
            .select(({ root, author }) => ({
                postId: root.id,
                authorEmail: author.email,
            }))
            .toSql()).toEqual({
            text: 'select [root].[id] as [postId], [author].[email] as [authorEmail] from [blog_posts] [root] inner join [authors] [author] on ([root].[author_id] = [author].[id] and [author].[email] like ? escape \'~\')',
            values: ['%@example.com%'],
        });
    });

    it('selects literal values in joined projections before joined predicate parameters', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        connection.queueResult({
            rows: [{
                rowKind: 'post-author',
                rank: 1,
                postId: 'post_1',
                authorEmail: 'author@example.com',
            }],
            rowCount: 1,
        });

        const rows = await db.posts
            .join('author', db.authors, ({ root, author }) => root.authorId.eq(author.id).and(author.status.eq('active')))
            .select(({ root, author }, project) => ({
                rowKind: project.literal('post-author'),
                rank: project.literal(1),
                postId: root.id,
                authorEmail: author.email,
            }))
            .toArray();

        expect(connection.statements).toEqual([{
            text: 'select $1 as "rowKind", $2 as "rank", "root"."id" as "postId", "author"."email" as "authorEmail" from "blog_posts" "root" inner join "authors" "author" on ("root"."author_id" = "author"."id" and "author"."status" = $3)',
            values: ['post-author', 1, 'active'],
        }]);
        expect(rows).toEqual([{
            rowKind: 'post-author',
            rank: 1,
            postId: 'post_1',
            authorEmail: 'author@example.com',
        }]);
        expect(db.changeTracker.entries()).toHaveLength(0);
    });

    it('combines joined sources in nested computed read models', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = createDb(connection);
        connection.queueResult({
            rows: [{
                __entitykit_projection_0: 'post_1',
                __entitykit_projection_1: 'Typed projections',
                __entitykit_projection_2: 'author@example.com',
                __entitykit_projection_3: 'active',
                summary: 'AUTHOR@EXAMPLE.COM: Typed projections',
            }],
            rowCount: 1,
        });

        const rows = await db.posts
            .join(
                'author',
                db.authors,
                ({ root, author }) => root.authorId.eq(author.id),
            )
            .select(({ root, author }, sql) => ({
                post: {
                    id: root.id,
                    title: root.title,
                },
                author: {
                    email: author.email,
                    status: author.status,
                },
                summary: sql.concat(
                    sql.upper(author.email),
                    sql.literal(': '),
                    root.title,
                ),
            }))
            .toArray();

        expect(rows).toEqual([{
            post: { id: 'post_1', title: 'Typed projections' },
            author: {
                email: 'author@example.com',
                status: 'active',
            },
            summary: 'AUTHOR@EXAMPLE.COM: Typed projections',
        }]);
        expect(connection.statements).toEqual([{
            text: 'select "root"."id" as "__entitykit_projection_0", "root"."title" as "__entitykit_projection_1", "author"."email" as "__entitykit_projection_2", "author"."status" as "__entitykit_projection_3", (upper("author"."email") || $1 || "root"."title") as "summary" from "blog_posts" "root" inner join "authors" "author" on "root"."author_id" = "author"."id"',
            values: [': '],
        }]);
    });
});
