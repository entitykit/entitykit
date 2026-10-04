import { DbValidationError } from '../packages/core/src';
import {
    createPost,
    createTag,
    ManyToManyContext,
    Tag,
} from './support/many-to-many-persistence-fixture';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

describe('many-to-many link validation', () => {
    it('rejects linked join rows with untracked endpoints before mutating navigation state', () => {
        const connection = new RecordingDatabaseConnection();
        const db =  ManyToManyContext.createWith(connection);
        const post = createPost();
        const tag = createTag();

        db.posts.attach(post);

        expect(() => {
            db.link(post, p => p.tags, tag);
        }).toThrow(DbValidationError);
        expect(() => {
            db.link(post, p => p.tags, tag);
        }).toThrow(
            'Cannot link many-to-many relationship \'Post.tags\' because the target entity \'Tag\' with key \'tag_1\' is not tracked by this DbContext.',
        );
        expect(post.tags).toEqual([]);
        expect(connection.statements).toEqual([]);
        expect(connection.transactionEvents).toEqual([]);
    });

    it('rejects linked join rows with empty endpoint keys before provider SQL', () => {
        const connection = new RecordingDatabaseConnection();
        const db =  ManyToManyContext.createWith(connection);
        const post = createPost();
        const tag = new Tag({ name: 'TypeScript' });

        db.posts.attach(post);

        expect(() => {
            db.link(post, p => p.tags, tag);
        }).toThrow(DbValidationError);
        expect(() => {
            db.link(post, p => p.tags, tag);
        }).toThrow(
            'Cannot link many-to-many relationship \'Post.tags\' because the target entity \'Tag\' has an empty key \'id\'.',
        );
        expect(post.tags).toEqual([]);
        expect(connection.statements).toEqual([]);
        expect(connection.transactionEvents).toEqual([]);
    });

    it.each([
        ['change tracker', (db: ManyToManyContext, tag: Tag) =>
            db.changeTracker.detach(tag)],
        ['DbSet', (db: ManyToManyContext, tag: Tag) => db.tags.detach(tag)],
    ] as const)('cancels queued join rows when detached through the %s', async (
        _label,
        detach,
    ) => {
        const connection = new RecordingDatabaseConnection();
        const db =  ManyToManyContext.createWith(connection);
        const post = createPost();
        const tag = createTag();

        db.posts.attach(post);
        db.tags.attach(tag);
        db.link(post, p => p.tags, tag);
        expect(detach(db, tag)).toBeDefined();

        expect(db.getSavePlan()).toEqual([]);
        await expect(db.saveChanges()).resolves.toBe(0);
        expect(post.tags).toEqual([tag]);
        expect(connection.statements).toEqual([]);
        expect(connection.transactionEvents).toEqual([]);
    });

    it('clears queued many-to-many changes through the context clearTracking API', () => {
        const connection = new RecordingDatabaseConnection();
        const db =  ManyToManyContext.createWith(connection);
        const post = createPost();
        const tag = createTag();

        db.posts.attach(post);
        db.tags.attach(tag);
        db.link(post, p => p.tags, tag);

        expect(db.getSavePlan()).toHaveLength(1);

        db.clearTracking();

        expect(db.getSavePlan()).toEqual([]);
        expect(db.getSavePlanDebugView()).toBe('No pending changes.');
        expect(connection.statements).toEqual([]);
        expect(connection.transactionEvents).toEqual([]);
    });

    it('accepts queued many-to-many changes with all tracked changes', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = ManyToManyContext.createWith(connection);
        const post = createPost();
        const tag = createTag();
        db.posts.attach(post);
        db.tags.attach(tag);
        db.link(post, item => item.tags, tag);
        expect(db.getSavePlan()).toHaveLength(1);

        db.changeTracker.acceptAllChanges();

        expect(db.getSavePlan()).toEqual([]);
        expect(db.getSavePlanDebugView()).toBe('No pending changes.');
        await expect(db.saveChanges()).resolves.toBe(0);
        expect(post.tags).toEqual([tag]);
        expect(connection.statements).toEqual([]);
        expect(connection.transactionEvents).toEqual([]);
    });
});
