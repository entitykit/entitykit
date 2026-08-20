import { type QueryPlanDiagnosticEvent } from '../../packages/core/src';
import { RecordingDatabaseConnection } from '../support/recording-database-connection';
import { containing } from '../support/jest-asymmetric-matchers';
import { AppDbContext, createDb, createScopedDb } from './support';

describe('joined projection filters and diagnostics', () => {
    afterEach(() => {
        AppDbContext.dialect = undefined;
    });

    it('applies root and joined source query filters by default', () => {
        const db =  createScopedDb();

        expect(db.posts
            .join('author', db.authors, ({ root, author }) => root.authorId.eq(author.id))
            .select(({ root, author }) => ({
                postId: root.id,
                authorEmail: author.email,
            }))
            .toSql()).toEqual({
            text: 'select "root"."id" as "postId", "author"."email" as "authorEmail" from "scoped_posts" "root" inner join "scoped_authors" "author" on "root"."author_id" = "author"."id" where ((("root"."deleted_at" is null and "root"."workspace_id" = $1) and "author"."deleted_at" is null) and "author"."workspace_id" = $2)',
            values: ['wrk_1', 'wrk_1'],
        });
    });

    it('can suppress root and joined source query filters', () => {
        const db =  createScopedDb();

        expect(db.posts
            .join('author', db.authors, ({ root, author }) => root.authorId.eq(author.id))
            .ignoreQueryFilters()
            .ignoreTenantScope()
            .select(({ root, author }) => ({
                postId: root.id,
                authorEmail: author.email,
            }))
            .toSql()).toEqual({
            text: 'select "root"."id" as "postId", "author"."email" as "authorEmail" from "scoped_posts" "root" inner join "scoped_authors" "author" on "root"."author_id" = "author"."id"',
            values: [],
        });
    });

    it('emits joined projection diagnostics with join shape', async () => {
        const connection = new RecordingDatabaseConnection();
        const db =  createDb(connection);
        connection.queueResult({
            rows: [{ postId: 'post_1', authorEmail: 'author@example.com' }],
            rowCount: 1,
        });

        await db.posts
            .join('author', db.authors, ({ root, author }) => root.authorId.eq(author.id))
            .select(({ root, author }) => ({
                postId: root.id,
                authorEmail: author.email,
            }))
            .where(({ author }) => author.status.eq('active'))
            .toArray();

        const planEvents = AppDbContext.diagnostics.filter(
            (event): event is QueryPlanDiagnosticEvent => event.kind === 'queryPlan',
        );

        expect(planEvents).toEqual([
            containing({
                kind: 'queryPlan',
                phase: 'compile',
                shape: containing({
                    entityName: 'BlogPost',
                    operation: 'projection',
                    hasPredicate: true,
                    joinCount: 1,
                    joinKinds: ['inner'],
                    projectionCount: 2,
                }),
            }),
            containing({
                kind: 'queryPlan',
                phase: 'execute',
                rowCount: 1,
                resultCount: 1,
                shape: containing({
                    entityName: 'BlogPost',
                    operation: 'projection',
                    joinCount: 1,
                    joinKinds: ['inner'],
                }),
            }),
        ]);
    });
});
