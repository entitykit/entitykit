import {
    createPost,
    createTag,
    ManyToManyContext,
    type Post,
    type Tag,
} from './support/many-to-many-persistence-fixture';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

/** Replace the collection with an accessor that keeps whatever it likes. */
function interceptTags(post: Post, store: (value: Tag[]) => Tag[]): void {
    let stored = post.tags;
    Object.defineProperty(post, 'tags', {
        configurable: true,
        enumerable: true,
        get: () => stored,
        set: (value: Tag[]) => {
            stored = store(value);
        },
    });
}

function attachedContext(): {
    db: ManyToManyContext;
    connection: RecordingDatabaseConnection;
    post: Post;
    first: Tag;
    second: Tag;
} {
    const connection = new RecordingDatabaseConnection();
    const db = ManyToManyContext.createWith(connection);
    const post = createPost();
    const first = createTag();
    const second = createTag('tag_2');
    db.posts.attach(post);
    db.tags.attach(first);
    db.tags.attach(second);
    return { db, connection, post, first, second };
}

function refusal(action: () => void): unknown {
    let reason: unknown;
    let threw = false;
    try {
        action();
    } catch (error) {
        threw = true;
        reason = error;
    }
    expect(threw).toBe(true);
    return reason;
}

describe('many-to-many link atomicity', () => {
    it('links into a frozen readonly collection', async () => {
        const { db, connection, post, first } = attachedContext();
        connection.queueResult({ rowCount: 1 });
        post.tags = Object.freeze([]) as unknown as Tag[];

        db.link(post, row => row.tags, first);

        expect(post.tags).toEqual([first]);
        expect(Object.isFrozen(post.tags)).toBe(false);
        expect(db.getSavePlanDebugView()).toContain('Post.tags');
        await db.saveChanges();
        expect(connection.statements[0]?.values).toEqual(['post_1', 'tag_1']);
        await db.dispose();
    });

    it('unlinks out of a frozen readonly collection', async () => {
        const { db, connection, post, first } = attachedContext();
        connection.queueResult({ rowCount: 1 });
        post.tags = Object.freeze([first]) as unknown as Tag[];

        db.unlink(post, row => row.tags, first);

        expect(post.tags).toEqual([]);
        await db.saveChanges();
        expect(connection.statements[0]?.text).toContain('delete from');
        await db.dispose();
    });

    it('unlinks only the requested tag out of a longer collection', async () => {
        const { db, connection, post, first, second } = attachedContext();
        const third = createTag('tag_3');
        db.tags.attach(third);
        connection.queueResult({ rowCount: 1 });
        post.tags = [first, second, third];

        db.unlink(post, row => row.tags, second);

        expect(post.tags).toHaveLength(2);
        expect(post.tags[0]).toBe(first);
        expect(post.tags[1]).toBe(third);
        await db.saveChanges();
        expect(connection.statements[0]?.values).toEqual(['post_1', 'tag_2']);
        await db.dispose();
    });

    it('links into a collection navigation the entity never populated', async () => {
        const { db, post, first } = attachedContext();
        Reflect.deleteProperty(post, 'tags');

        db.link(post, row => row.tags, first);

        expect(post.tags).toHaveLength(1);
        expect(post.tags[0]).toBe(first);
        await db.dispose();
    });

    it('queues no join work when a link is refused', async () => {
        const { db, connection, post, first } = attachedContext();
        interceptTags(post, () => []);

        const failure = refusal(() => {
            db.link(post, row => row.tags, first);
        });

        expect((failure as Error).message).toBe(
            'Navigation \'Post.tags\' refused its assigned value.',
        );
        expect(post.tags).toEqual([]);
        expect(db.getSavePlan()).toEqual([]);
        expect(db.getSavePlanDebugView()).not.toContain('Post.tags');
        await expect(db.saveChanges()).resolves.toBe(0);
        expect(connection.statements).toEqual([]);
        await db.dispose();
    });

    it('queues no join work when an unlink is refused', async () => {
        const { db, connection, post, first } = attachedContext();
        post.tags = [first];
        interceptTags(post, () => [first]);

        const failure = refusal(() => {
            db.unlink(post, row => row.tags, first);
        });

        expect((failure as Error).message).toBe(
            'Navigation \'Post.tags\' refused its assigned value.',
        );
        expect(post.tags).toEqual([first]);
        expect(db.getSavePlan()).toEqual([]);
        await expect(db.saveChanges()).resolves.toBe(0);
        expect(connection.statements).toEqual([]);
        await db.dispose();
    });

    it('keeps earlier queued links when a later link is refused', async () => {
        const { db, connection, post, first, second } = attachedContext();
        connection.queueResult({ rowCount: 1 });
        db.link(post, row => row.tags, first);
        interceptTags(post, () => [first]);

        refusal(() => {
            db.link(post, row => row.tags, second);
        });

        expect(post.tags).toEqual([first]);
        expect(db.getSavePlan()).toHaveLength(1);
        expect(db.getSavePlanDebugView()).toContain('relationships: 1');
        await db.saveChanges();
        expect(connection.statements[0]?.values).toEqual(['post_1', 'tag_1']);
        await db.dispose();
    });
});
