import {
    createTag,
    ManyToManyContext,
    Post,
} from './support/many-to-many-persistence-fixture';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

describe('many-to-many unlink persistence', () => {
    it('persists unlinked join rows during saveChanges', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 1 });
        const db =  ManyToManyContext.createWith(connection);
        const tag = createTag();
        const post = new Post({ id: 'post_1', title: 'Hello', tags: [tag] });

        db.posts.attach(post);
        db.tags.attach(tag);
        db.unlink(post, p => p.tags, tag);
        await db.saveChanges();

        expect(post.tags).toEqual([]);
        expect(connection.statements[0]).toEqual({
            text: 'delete from "post_tags" where "post_id" = $1 and "tag_id" = $2',
            values: ['post_1', 'tag_1'],
        });
    });

    it('batches compatible unlinked join rows during saveChanges', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 2 });
        const db =  ManyToManyContext.createWith(connection);
        const tag1 = createTag();
        const tag2 = createTag('tag_2');
        const post = new Post({
            id: 'post_1',
            title: 'Hello',
            tags: [tag1, tag2],
        });

        db.posts.attach(post);
        db.tags.attach(tag1);
        db.tags.attach(tag2);
        db.unlink(post, p => p.tags, tag1);
        db.unlink(post, p => p.tags, tag2);
        await db.saveChanges();

        expect(post.tags).toEqual([]);
        expect(connection.statements).toHaveLength(1);
        expect(connection.statements[0]).toEqual({
            text: 'delete from "post_tags" where ("post_id" = $1 and "tag_id" = $2) or ("post_id" = $3 and "tag_id" = $4)',
            values: ['post_1', 'tag_1', 'post_1', 'tag_2'],
        });
    });

    it('deduplicates repeated unlinked join rows during saveChanges', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 1 });
        const db =  ManyToManyContext.createWith(connection);
        const tag = createTag();
        const post = new Post({ id: 'post_1', title: 'Hello', tags: [tag] });

        db.posts.attach(post);
        db.tags.attach(tag);
        db.unlink(post, p => p.tags, tag);
        db.unlink(post, p => p.tags, tag);

        await db.saveChanges();

        expect(post.tags).toEqual([]);
        expect(connection.statements).toEqual([{
            text: 'delete from "post_tags" where "post_id" = $1 and "tag_id" = $2',
            values: ['post_1', 'tag_1'],
        }]);
    });

    it('rolls back and keeps batched unlinked join rows pending when the provider fails', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueError(new Error('join delete failed'));
        const db =  ManyToManyContext.createWith(connection);
        const tag1 = createTag();
        const tag2 = createTag('tag_2');
        const post = new Post({
            id: 'post_1',
            title: 'Hello',
            tags: [tag1, tag2],
        });

        db.posts.attach(post);
        db.tags.attach(tag1);
        db.tags.attach(tag2);
        db.unlink(post, p => p.tags, tag1);
        db.unlink(post, p => p.tags, tag2);

        await expect(db.saveChanges()).rejects.toThrow('join delete failed');

        expect(connection.transactionEvents).toEqual(['begin', 'rollback']);
        expect(connection.statements).toHaveLength(1);
        expect(db.getSavePlan()).toHaveLength(1);
        expect(db.getSavePlanDebugView()).toContain('2 changes');
        expect(post.tags).toEqual([]);
    });
});
