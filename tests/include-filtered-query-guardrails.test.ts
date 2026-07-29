import {
    createIncludeGuardrailDb,
    fallbackIncludeDialect,
    includeEvents,
} from './support/include-performance-guardrail-context';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

describe('filtered include performance guardrails', () => {
    it('uses windowedBatch for Postgres filtered includes instead of per-parent fallback', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({
            rows: [
                { id: 'usr_1', email: 'a@example.com' },
                { id: 'usr_2', email: 'b@example.com' },
            ],
            rowCount: 2,
        });
        connection.queueResult({
            rows: [
                { __entitykit_parent_key: 'usr_1', id: 'post_1', title: 'One', author_id: 'usr_1', workspace_id: 'wrk_1', deleted_at: null },
                { __entitykit_parent_key: 'usr_2', id: 'post_2', title: 'Two', author_id: 'usr_2', workspace_id: 'wrk_1', deleted_at: null },
            ],
            rowCount: 2,
        });
        const db =  createIncludeGuardrailDb(connection);

        await db.users
            .include(user => user.posts.orderBy(post => post.id).take(1))
            .toArray();

        expect(connection.statements).toHaveLength(2);
        expect(connection.statements[1]?.text).toContain('row_number() over (partition by "t"."author_id" order by "t"."id" asc)');
        expect(connection.statements[1]?.values).toEqual(['usr_1', 'usr_2', 'wrk_1', 1]);
        expect(includeEvents()).toEqual([
            expect.objectContaining({
                strategy: 'windowedBatch',
                parentEntityName: 'User',
                relatedEntityName: 'Post',
                navigationProperty: 'posts',
                parentCount: 2,
                keyCount: 2,
                rowCount: 2,
                loadedCount: 2,
            }),
        ]);
    });

    it('keeps perParentFallback visible for non-Postgres filtered includes', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({
            rows: [
                { id: 'usr_1', email: 'a@example.com' },
                { id: 'usr_2', email: 'b@example.com' },
            ],
            rowCount: 2,
        });
        connection.queueResult({
            rows: [{ id: 'post_1', title: 'One', author_id: 'usr_1', workspace_id: 'wrk_1', deleted_at: null }],
            rowCount: 1,
        });
        connection.queueResult({
            rows: [{ id: 'post_2', title: 'Two', author_id: 'usr_2', workspace_id: 'wrk_1', deleted_at: null }],
            rowCount: 1,
        });
        const db =  createIncludeGuardrailDb(connection, fallbackIncludeDialect);

        await db.users
            .include(user => user.posts.orderBy(post => post.id).take(1))
            .toArray();

        expect(connection.statements).toHaveLength(3);
        expect(connection.statements[1]?.values).toEqual(['usr_1', 'wrk_1', 1]);
        expect(connection.statements[2]?.values).toEqual(['usr_2', 'wrk_1', 1]);
        expect(includeEvents()).toEqual([
            expect.objectContaining({
                strategy: 'perParentFallback',
                parentEntityName: 'User',
                relatedEntityName: 'Post',
                navigationProperty: 'posts',
                parentCount: 2,
                keyCount: 2,
                rowCount: 2,
                loadedCount: 2,
            }),
        ]);
    });
});
