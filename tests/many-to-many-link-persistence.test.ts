import { mySqlProviderServices } from '../src/providers/mysql';
import {
    createPost,
    createTag,
    ManyToManyContext,
    Post,
} from './support/many-to-many-persistence-fixture';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

describe('many-to-many link persistence', () => {
    it('persists linked join rows during saveChanges', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 1 });
        const db =  ManyToManyContext.createWith(connection);
        const post = createPost();
        const tag = createTag();

        db.posts.attach(post);
        db.tags.attach(tag);
        db.link(post, p => p.tags, tag);

        expect(post.tags).toEqual([tag]);
        expect(db.getSavePlanDebugView()).toContain('Post.tags');

        await db.saveChanges();

        expect(connection.statements[0]).toEqual({
            text: 'insert into "post_tags" ("post_id", "tag_id") values ($1, $2) on conflict do nothing',
            values: ['post_1', 'tag_1'],
        });
    });

    it('batches compatible linked join rows during saveChanges', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 2 });
        const db =  ManyToManyContext.createWith(connection);
        const post = createPost();
        const tag1 = createTag();
        const tag2 = createTag('tag_2');

        db.posts.attach(post);
        db.tags.attach(tag1);
        db.tags.attach(tag2);
        db.link(post, p => p.tags, tag1);
        db.link(post, p => p.tags, tag2);

        expect(db.getSavePlan()).toHaveLength(1);
        expect(db.getSavePlanDebugView()).toContain('2 changes');

        await db.saveChanges();

        expect(connection.statements).toHaveLength(1);
        expect(connection.statements[0]).toEqual({
            text: 'insert into "post_tags" ("post_id", "tag_id") values ($1, $2), ($3, $4) on conflict do nothing',
            values: ['post_1', 'tag_1', 'post_1', 'tag_2'],
        });
    });

    it('batches compatible linked join rows across multiple source entities', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 2 });
        const db =  ManyToManyContext.createWith(connection);
        const post1 = createPost();
        const post2 = createPost('post_2');
        const tag1 = createTag();
        const tag2 = createTag('tag_2');

        db.posts.attach(post1);
        db.posts.attach(post2);
        db.tags.attach(tag1);
        db.tags.attach(tag2);
        db.link(post1, p => p.tags, tag1);
        db.link(post2, p => p.tags, tag2);

        expect(db.getSavePlan()).toHaveLength(1);
        expect(db.getSavePlanDebugView()).toContain('2 changes');

        await db.saveChanges();

        expect(connection.statements).toHaveLength(1);
        expect(connection.statements[0]).toEqual({
            text: 'insert into "post_tags" ("post_id", "tag_id") values ($1, $2), ($3, $4) on conflict do nothing',
            values: ['post_1', 'tag_1', 'post_2', 'tag_2'],
        });
    });

    it('deduplicates repeated linked join rows during saveChanges', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 1 });
        const db =  ManyToManyContext.createWith(connection);
        const post = createPost();
        const tag = createTag();

        db.posts.attach(post);
        db.tags.attach(tag);
        db.link(post, p => p.tags, tag);
        db.link(post, p => p.tags, tag);

        expect(post.tags).toEqual([tag]);
        expect(db.getSavePlanDebugView()).toContain('post_1->tag_1');

        await db.saveChanges();

        expect(connection.statements).toEqual([{
            text: 'insert into "post_tags" ("post_id", "tag_id") values ($1, $2) on conflict do nothing',
            values: ['post_1', 'tag_1'],
        }]);
    });

    it('keeps the last action when an existing link is unlinked then relinked', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 1 });
        const db =  ManyToManyContext.createWith(connection);
        const tag = createTag();
        const post = new Post({ id: 'post_1', title: 'Hello', tags: [tag] });

        db.posts.attach(post);
        db.tags.attach(tag);
        db.unlink(post, p => p.tags, tag);
        db.link(post, p => p.tags, tag);
        await db.saveChanges();

        expect(post.tags).toEqual([tag]);
        expect(connection.statements).toEqual([{
            text: 'insert into "post_tags" ("post_id", "tag_id") values ($1, $2) on conflict do nothing',
            values: ['post_1', 'tag_1'],
        }]);
    });

    it('uses a real join column for MySQL\'s do-nothing clause, not a hardcoded id', () => {
        expect(mySqlProviderServices.dialect.insertConflictDoNothingClause(['post_id', 'tag_id']))
            .toBe('on duplicate key update `post_id` = `post_id`');
    });

    it('rolls back and keeps batched linked join rows pending when the provider fails', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueError(new Error('join insert failed'));
        const db =  ManyToManyContext.createWith(connection);
        const post = createPost();
        const tag1 = createTag();
        const tag2 = createTag('tag_2');

        db.posts.attach(post);
        db.tags.attach(tag1);
        db.tags.attach(tag2);
        db.link(post, p => p.tags, tag1);
        db.link(post, p => p.tags, tag2);

        await expect(db.saveChanges()).rejects.toThrow('join insert failed');

        expect(connection.transactionEvents).toEqual([]);
        expect(connection.statements).toHaveLength(1);
        expect(db.getSavePlan()).toHaveLength(1);
        expect(db.getSavePlanDebugView()).toContain('2 changes');
        expect(post.tags).toEqual([tag1, tag2]);
    });
});
