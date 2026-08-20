import { sqliteDialect } from '../packages/sqlite/src/sqlite-dialect';
import { mySqlDialect } from '../packages/mysql/src/mysql-dialect';
import { RecordingDatabaseConnection } from './support/recording-database-connection';
import {
    IncludeManyToManyContext,
    Post,
    Tag,
} from './support/many-to-many-include-context';

describe('many-to-many include loading', () => {
    it('preserves a queued local link during an ordinary tracking include', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = IncludeManyToManyContext.createWith(connection);
        const post = new Post({ id: 'post_1', title: 'Hello' });
        const local = new Tag({
            id: 'local', workspaceId: 'wrk_1', name: 'Local',
        });
        db.posts.attach(post);
        db.tags.attach(local);
        db.link(post, item => item.tags, local);
        connection.queueResult({
            rows: [{ id: 'post_1', title: 'Hello' }], rowCount: 1,
        });
        connection.queueResult({
            rows: [{
                __entitykit_parent_key: 'post_1', id: 'stored',
                workspace_id: 'wrk_1', name: 'Stored', deleted_at: null,
            }],
            rowCount: 1,
        });

        const queried = await db.posts.include(item => item.tags).single();

        expect(queried).toBe(post);
        expect(post.tags).toEqual([local]);
    });

    it('preserves a queued local unlink during an ordinary tracking include', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = IncludeManyToManyContext.createWith(connection);
        const tag = new Tag({
            id: 'tag_1', workspaceId: 'wrk_1', name: 'TypeScript',
        });
        const post = new Post({ id: 'post_1', title: 'Hello', tags: [tag] });
        db.posts.attach(post);
        db.tags.attach(tag);
        db.unlink(post, item => item.tags, tag);
        connection.queueResult({
            rows: [{ id: 'post_1', title: 'Hello' }], rowCount: 1,
        });
        connection.queueResult({
            rows: [{
                __entitykit_parent_key: 'post_1', id: 'tag_1',
                workspace_id: 'wrk_1', name: 'TypeScript', deleted_at: null,
            }],
            rowCount: 1,
        });

        await db.posts.include(item => item.tags).single();

        expect(post.tags).toEqual([]);
    });

    it('does not recurse through a stored link skipped by pending unlink intent', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = IncludeManyToManyContext.createWith(connection);
        const tag = new Tag({
            id: 'tag_1', workspaceId: 'wrk_1', name: 'TypeScript',
        });
        const post = new Post({ id: 'post_1', title: 'Hello', tags: [tag] });
        db.posts.attach(post);
        db.tags.attach(tag);
        db.unlink(post, item => item.tags, tag);
        connection.queueResult({
            rows: [{ id: 'post_1', title: 'Hello' }], rowCount: 1,
        });
        connection.queueResult({
            rows: [{
                __entitykit_parent_key: 'post_1', id: 'tag_1',
                workspace_id: 'wrk_1', name: 'TypeScript', deleted_at: null,
            }],
            rowCount: 1,
        });

        await db.posts.include(item => item.tags)
            .thenInclude(item => item.posts).single();
        expect(post.tags).toEqual([]);
        expect(connection.statements).toHaveLength(2);
    });

    it('rejects a mutated root key before a many-to-many query', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = IncludeManyToManyContext.createWith(connection);
        const post = new Post({ id: 'post_1', title: 'Hello' });
        const tags = db.posts.attach(post).collection(item => item.tags);
        post.id = 'post_2';

        await expect(tags.load()).rejects.toThrow(
            'Primary key changes are not supported for entity \'Post\' (property \'id\').',
        );
        expect(connection.statements).toEqual([]);
    });

    it('loads direct many-to-many collections with split queries', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rows: [{ id: 'post_1', title: 'Hello' }], rowCount: 1 });
        connection.queueResult({ rows: [{ __entitykit_parent_key: 'post_1', id: 'tag_1', workspace_id: 'wrk_1', name: 'TypeScript', deleted_at: null }], rowCount: 1 });
        const db =  IncludeManyToManyContext.createWith(connection);

        const posts = await db.posts.include(post => post.tags).toArray();

        expect(posts).toHaveLength(1);
        expect(posts[0]).toBeInstanceOf(Post);
        expect(posts[0]?.tags).toHaveLength(1);
        expect(posts[0]?.tags[0]).toBeInstanceOf(Tag);
        expect(posts[0]?.tags[0]?.posts).toEqual([posts[0]]);
        expect(db.entry(posts[0])?.isNavigationLoaded('tags')).toBe(true);
        expect(connection.statements[1]?.text).toContain('from "post_tags" "j" join "tags" "t"');
        expect(connection.statements[1]?.text).toContain('"t"."deleted_at" is null');
        expect(connection.statements[1]?.text).toContain('"t"."workspace_id" = $2');
        expect(connection.statements[1]?.values).toEqual(['post_1', 'wrk_1']);
    });

    it('loads inverse many-to-many collections with split queries', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rows: [{ id: 'tag_1', workspace_id: 'wrk_1', name: 'TypeScript', deleted_at: null }], rowCount: 1 });
        connection.queueResult({ rows: [{ __entitykit_parent_key: 'tag_1', id: 'post_1', title: 'Hello' }], rowCount: 1 });
        const db =  IncludeManyToManyContext.createWith(connection);

        const tags = await db.tags.include(tag => tag.posts).toArray();

        expect(tags[0]?.posts).toHaveLength(1);
        expect(tags[0]?.posts[0]).toBeInstanceOf(Post);
        expect(tags[0]?.posts[0]?.tags).toEqual([tags[0]]);
        expect(db.entry(tags[0])?.isNavigationLoaded('posts')).toBe(true);
        expect(connection.statements[1]?.text).toContain('from "post_tags" "j" join "posts" "t"');
        expect(connection.statements[1]?.values).toEqual(['tag_1']);
    });

    it('aliases filtered many-to-many include predicates against the related table', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rows: [{ id: 'post_1', title: 'Hello' }], rowCount: 1 });
        connection.queueResult({ rows: [{ __entitykit_parent_key: 'post_1', id: 'tag_1', workspace_id: 'wrk_1', name: 'TypeScript', deleted_at: null }], rowCount: 1 });
        const db =  IncludeManyToManyContext.createWith(connection);

        await db.posts
            .include(post => post.tags.where(tag => tag.name.startsWith('Type')).orderBy(tag => tag.name).take(5))
            .toArray();

        expect(connection.statements[1]?.text).toContain('"t"."name" like $2');
        expect(connection.statements[1]?.text).toContain('"t"."deleted_at" is null');
        expect(connection.statements[1]?.text).toContain('"t"."workspace_id" = $3');
        expect(connection.statements[1]?.text).toContain('order by "t"."name" asc');
        expect(connection.statements[1]?.text).toContain('limit $4');
        expect(connection.statements[1]?.values).toEqual(['post_1', 'Type%', 'wrk_1', 5]);
    });

    it('places nulls SQL-standard in the batch order-by for SQLite', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rows: [{ id: 'post_1', title: 'Hello' }], rowCount: 1 });
        connection.queueResult({ rows: [{ __entitykit_parent_key: 'post_1', id: 'tag_1', workspace_id: 'wrk_1', name: 'TypeScript', deleted_at: null }], rowCount: 1 });
        const db =  IncludeManyToManyContext.createWith(connection, sqliteDialect);

        // A plain ordered include (no take/skip) takes the batch path. SQLite sorts
        // nulls low by default, so the include must state `nulls last` to match a
        // top-level `orderBy` and the other providers.
        await db.posts.include(post => post.tags.orderBy(tag => tag.name)).toArray();

        expect(connection.statements[1]?.text).toContain('order by "t"."name" asc nulls last');
    });

    it('places nulls SQL-standard in the batch order-by for MySQL', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rows: [{ id: 'post_1', title: 'Hello' }], rowCount: 1 });
        connection.queueResult({ rows: [{ __entitykit_parent_key: 'post_1', id: 'tag_1', workspace_id: 'wrk_1', name: 'TypeScript', deleted_at: null }], rowCount: 1 });
        const db =  IncludeManyToManyContext.createWith(connection, mySqlDialect);

        await db.posts.include(post => post.tags.orderByDescending(tag => tag.name)).toArray();

        // MySQL has no `NULLS` keyword; the leading `(col is null)` term is how the
        // batch order-by keeps descending nulls first (SQL-standard).
        expect(connection.statements[1]?.text).toContain('order by `t`.`name` is null desc, `t`.`name` desc');
    });

    it('uses a windowed split query when many-to-many filtered includes use take', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({
            rows: [
                { id: 'post_1', title: 'First' },
                { id: 'post_2', title: 'Second' },
            ],
            rowCount: 2,
        });
        connection.queueResult({
            rows: [
                { __entitykit_parent_key: 'post_1', id: 'tag_1', workspace_id: 'wrk_1', name: 'Alpha', deleted_at: null },
                { __entitykit_parent_key: 'post_2', id: 'tag_2', workspace_id: 'wrk_1', name: 'Beta', deleted_at: null },
            ],
            rowCount: 2,
        });
        const db =  IncludeManyToManyContext.createWith(connection);

        const posts = await db.posts
            .include(post => post.tags.orderBy(tag => tag.name).take(1))
            .toArray();

        expect(connection.statements).toHaveLength(2);
        expect(connection.statements[1]?.text).toContain('row_number() over (partition by "j"."post_id" order by "t"."name" asc)');
        expect(connection.statements[1]?.text).toContain('where "j"."post_id" in ($1, $2)');
        expect(connection.statements[1]?.text).toContain('"t"."deleted_at" is null');
        expect(connection.statements[1]?.text).toContain('"t"."workspace_id" = $3');
        expect(connection.statements[1]?.text).toContain('where "__entitykit_include"."__entitykit_include_row_number" <= $4');
        expect(connection.statements[1]?.values).toEqual(['post_1', 'post_2', 'wrk_1', 1]);
        expect(posts[0]?.tags.map(tag => tag.id)).toEqual(['tag_1']);
        expect(posts[1]?.tags.map(tag => tag.id)).toEqual(['tag_2']);
    });

    it('keeps many-to-many skip and take per parent in a windowed split query', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({
            rows: [
                { id: 'post_1', title: 'First' },
                { id: 'post_2', title: 'Second' },
            ],
            rowCount: 2,
        });
        connection.queueResult({
            rows: [
                { __entitykit_parent_key: 'post_1', id: 'tag_2', workspace_id: 'wrk_1', name: 'Beta', deleted_at: null },
                { __entitykit_parent_key: 'post_2', id: 'tag_4', workspace_id: 'wrk_1', name: 'Delta', deleted_at: null },
            ],
            rowCount: 2,
        });
        const db =  IncludeManyToManyContext.createWith(connection);

        const posts = await db.posts
            .include(post => post.tags.orderBy(tag => tag.name).skip(1).take(1))
            .toArray();

        expect(connection.statements).toHaveLength(2);
        expect(connection.statements[1]?.text).toContain('row_number() over (partition by "j"."post_id" order by "t"."name" asc)');
        expect(connection.statements[1]?.text).toContain('where "j"."post_id" in ($1, $2)');
        expect(connection.statements[1]?.text).toContain('"t"."deleted_at" is null');
        expect(connection.statements[1]?.text).toContain('"t"."workspace_id" = $3');
        expect(connection.statements[1]?.text).toContain('where "__entitykit_include"."__entitykit_include_row_number" > $4 and "__entitykit_include"."__entitykit_include_row_number" <= $5');
        expect(connection.statements[1]?.values).toEqual(['post_1', 'post_2', 'wrk_1', 1, 2]);
        expect(posts[0]?.tags.map(tag => tag.id)).toEqual(['tag_2']);
        expect(posts[1]?.tags.map(tag => tag.id)).toEqual(['tag_4']);
    });

    it('assigns an empty collection to a parent with no join rows', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({
            rows: [
                { id: 'post_1', title: 'First' },
                { id: 'post_2', title: 'Second' },
            ],
            rowCount: 2,
        });
        connection.queueResult({
            rows: [{ __entitykit_parent_key: 'post_1', id: 'tag_1', workspace_id: 'wrk_1', name: 'Alpha', deleted_at: null }],
            rowCount: 1,
        });
        const db = IncludeManyToManyContext.createWith(connection);

        const posts = await db.posts.include(post => post.tags).toArray();

        expect(posts[0]?.tags.map(tag => tag.id)).toEqual(['tag_1']);
        expect(posts[1]?.tags).toEqual([]);
        expect(db.entry(posts[1])?.isNavigationLoaded('tags')).toBe(true);
    });

    it('deduplicates windowed many-to-many include rows during parent and inverse fix-up', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({
            rows: [
                { id: 'post_1', title: 'First' },
                { id: 'post_2', title: 'Second' },
            ],
            rowCount: 2,
        });
        connection.queueResult({
            rows: [
                { __entitykit_parent_key: 'post_1', id: 'tag_1', workspace_id: 'wrk_1', name: 'Shared', deleted_at: null },
                { __entitykit_parent_key: 'post_1', id: 'tag_1', workspace_id: 'wrk_1', name: 'Shared', deleted_at: null },
                { __entitykit_parent_key: 'post_2', id: 'tag_1', workspace_id: 'wrk_1', name: 'Shared', deleted_at: null },
            ],
            rowCount: 3,
        });
        const db =  IncludeManyToManyContext.createWith(connection);

        const posts = await db.posts
            .include(post => post.tags.orderBy(tag => tag.name).take(2))
            .toArray();

        const sharedTag = posts[0]?.tags[0];
        expect(posts[0]?.tags).toEqual([sharedTag]);
        expect(posts[1]?.tags).toEqual([sharedTag]);
        expect(sharedTag.posts).toEqual([posts[0], posts[1]]);
    });
});
