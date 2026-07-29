import {
    createIncludeGuardrailDb,
    includeEvents,
} from './support/include-performance-guardrail-context';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

describe('include split-query performance guardrails', () => {
    it('keeps one-to-many split includes to one related query with related filters', async () => {
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
        const db =  createIncludeGuardrailDb(connection);

        await db.users.include(user => user.posts).toArray();

        expect(connection.statements).toHaveLength(2);
        expect(connection.statements[1]?.text).toContain('"author_id" in ($1, $2)');
        expect(connection.statements[1]?.text).toContain('"deleted_at" is null');
        expect(connection.statements[1]?.text).toContain('"workspace_id" = $3');
        expect(connection.statements[1]?.values).toEqual(['usr_1', 'usr_2', 'wrk_1']);
        expect(includeEvents()).toEqual([
            expect.objectContaining({
                strategy: 'splitQuery',
                parentEntityName: 'User',
                relatedEntityName: 'Post',
                navigationProperty: 'posts',
                parentCount: 2,
                keyCount: 2,
                rowCount: 1,
                loadedCount: 1,
            }),
        ]);
    });

    it('deduplicates many-to-one keys so duplicate parents do not add related queries', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({
            rows: [
                { id: 'post_1', title: 'One', author_id: 'usr_1', workspace_id: 'wrk_1', deleted_at: null },
                { id: 'post_2', title: 'Two', author_id: 'usr_1', workspace_id: 'wrk_1', deleted_at: null },
            ],
            rowCount: 2,
        });
        connection.queueResult({
            rows: [{ id: 'usr_1', email: 'a@example.com' }],
            rowCount: 1,
        });
        const db =  createIncludeGuardrailDb(connection);

        await db.posts.include(post => post.author).toArray();

        expect(connection.statements).toHaveLength(2);
        expect(connection.statements[1]).toEqual({
            text: 'select "id", "email" from "users" where "id" in ($1)',
            values: ['usr_1'],
        });
        expect(includeEvents()).toEqual([
            expect.objectContaining({
                strategy: 'splitQuery',
                parentEntityName: 'Post',
                relatedEntityName: 'User',
                navigationProperty: 'author',
                parentCount: 2,
                keyCount: 1,
                rowCount: 1,
                loadedCount: 1,
            }),
        ]);
    });

    it('skips all-null foreign-key includes without querying principals', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({
            rows: [{ id: 'post_1', title: 'One', author_id: null, workspace_id: 'wrk_1', deleted_at: null }],
            rowCount: 1,
        });
        const db =  createIncludeGuardrailDb(connection);

        const posts = await db.posts.include(post => post.author).toArray();

        expect(posts[0]?.author).toBeNull();
        expect(connection.statements).toHaveLength(1);
        expect(includeEvents()).toEqual([
            expect.objectContaining({
                strategy: 'skipped',
                parentEntityName: 'Post',
                relatedEntityName: 'User',
                navigationProperty: 'author',
                parentCount: 1,
                keyCount: 0,
                rowCount: 0,
                loadedCount: 0,
            }),
        ]);
    });

    it('keeps many-to-many split includes to one related query with related filters', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({
            rows: [
                { id: 'post_1', title: 'One', author_id: 'usr_1', workspace_id: 'wrk_1', deleted_at: null },
                { id: 'post_2', title: 'Two', author_id: 'usr_2', workspace_id: 'wrk_1', deleted_at: null },
            ],
            rowCount: 2,
        });
        connection.queueResult({
            rows: [{ __entitykit_parent_key: 'post_1', id: 'tag_1', name: 'Alpha', workspace_id: 'wrk_1', deleted_at: null }],
            rowCount: 1,
        });
        const db =  createIncludeGuardrailDb(connection);

        await db.posts.include(post => post.tags).toArray();

        expect(connection.statements).toHaveLength(2);
        expect(connection.statements[1]?.text).toContain('from "post_tags" "j" join "tags" "t"');
        expect(connection.statements[1]?.text).toContain('"j"."post_id" in ($1, $2)');
        expect(connection.statements[1]?.text).toContain('"t"."deleted_at" is null');
        expect(connection.statements[1]?.text).toContain('"t"."workspace_id" = $3');
        expect(connection.statements[1]?.values).toEqual(['post_1', 'post_2', 'wrk_1']);
        expect(includeEvents()).toEqual([
            expect.objectContaining({
                strategy: 'splitQuery',
                parentEntityName: 'Post',
                relatedEntityName: 'Tag',
                navigationProperty: 'tags',
                parentCount: 2,
                keyCount: 2,
                rowCount: 1,
                loadedCount: 1,
            }),
        ]);
    });

    it('keeps nested includes at one query per include level', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rows: [{ id: 'usr_1', email: 'a@example.com' }], rowCount: 1 });
        connection.queueResult({ rows: [{ id: 'post_1', title: 'One', author_id: 'usr_1', workspace_id: 'wrk_1', deleted_at: null }], rowCount: 1 });
        connection.queueResult({ rows: [{ id: 'usr_1', email: 'a@example.com' }], rowCount: 1 });
        const db =  createIncludeGuardrailDb(connection);

        await db.users
            .include(user => user.posts)
            .thenInclude(post => post.author)
            .toArray();

        expect(connection.statements).toHaveLength(3);
        expect(includeEvents().map(event => event.strategy)).toEqual(['splitQuery', 'splitQuery']);
        expect(includeEvents().map(event => event.navigationProperty)).toEqual(['posts', 'author']);
    });
});
