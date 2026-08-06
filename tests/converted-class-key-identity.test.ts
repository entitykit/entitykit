import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, DeleteBehavior, lazy, valueConverter } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';

class StrongId {
    readonly #value: string;

    constructor(value: string) {
        this.#value = value;
    }

    public get value(): string {
        return this.#value;
    }
}

const strongId = valueConverter<StrongId, string>({
    toProvider: value => value.value,
    fromProvider: value => new StrongId(value),
});

class StrongPost {
    public id!: StrongId;
    public title = '';
    public tags: StrongTag[] = [];
    public comments: StrongComment[] = [];
}

class StrongTag {
    public id!: StrongId;
    public name = '';
    public posts: StrongPost[] = [];
}

class StrongComment {
    public id = '';
    public postId!: StrongId;
    public body = '';
    public post?: StrongPost;
}

class StrongIdentityContext extends DbContext {
    public posts = this.set(StrongPost);
    public tags = this.set(StrongTag);
    public comments = this.set(StrongComment);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:')
            .useLazyLoading({ maxPerContext: 2 });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(StrongPost, entity => {
            entity.toTable('strong_posts');
            entity.hasKey(post => post.id);
            entity.property(post => post.id).hasColumnType('text')
                .hasConversion(strongId).isRequired();
            entity.property(post => post.title).hasColumnType('text').isRequired();
            entity.hasManyToMany(StrongTag, post => post.tags)
                .withMany(tag => tag.posts)
                .usingJoinTable('strong_post_tags', join => {
                    join.sourceForeignKey('post_id');
                    join.targetForeignKey('tag_id');
                });
        });
        model.entity(StrongTag, entity => {
            entity.toTable('strong_tags');
            entity.hasKey(tag => tag.id);
            entity.property(tag => tag.id).hasColumnType('text')
                .hasConversion(strongId).isRequired();
            entity.property(tag => tag.name).hasColumnType('text').isRequired();
        });
        model.entity(StrongComment, entity => {
            entity.toTable('strong_comments');
            entity.hasKey(comment => comment.id);
            entity.property(comment => comment.id).hasColumnType('text').isRequired();
            entity.property(comment => comment.postId).hasColumnName('post_id')
                .hasColumnType('text').hasConversion(strongId).isRequired();
            entity.property(comment => comment.body).hasColumnType('text').isRequired();
            entity.hasOne(StrongPost, comment => comment.post)
                .withMany(post => post.comments)
                .hasForeignKey(comment => comment.postId)
                .onDelete(DeleteBehavior.Cascade);
        });
    }
}

async function open(): Promise<StrongIdentityContext> {
    const db = StrongIdentityContext.create();
    await db.database.connection.query({
        text: db.database.createScript(),
        values: [],
    });
    return db;
}

describe('converted class key identity', () => {
    it('normalizes tracking collisions through the key converter', async () => {
        const db = await open();
        const first = Object.assign(new StrongPost(), {
            id: new StrongId('post-1'),
            title: 'first',
        });
        const duplicate = Object.assign(new StrongPost(), {
            id: new StrongId('post-1'),
            title: 'duplicate',
        });

        db.posts.add(first);
        expect(() => db.posts.add(duplicate)).toThrow('already tracked');
        expect(db.changeTracker.entries()).toHaveLength(1);
        await db.dispose();
    });

    it('adds and finds strongly typed keys by provider identity', async () => {
        const db = await open();
        const post = Object.assign(new StrongPost(), {
            id: new StrongId('post-1'),
            title: 'post',
        });
        db.posts.add(post);
        await expect(db.saveChanges()).resolves.toBe(1);
        db.changeTracker.clear();

        const first = await db.posts.find(new StrongId('post-1'));
        const second = await db.posts.find(new StrongId('post-1'));

        expect(first).toBe(second);
        expect(first?.id.value).toBe('post-1');
        expect(db.changeTracker.entries()).toHaveLength(1);
        await db.dispose();
    });

    it('materializes and loads relationships with converted class keys', async () => {
        const db = await open();
        await db.database.connection.query({
            text: 'insert into strong_posts (id, title) values (?, ?)',
            values: ['post-1', 'post'],
        });
        await db.database.connection.query({
            text: 'insert into strong_tags (id, name) values (?, ?)',
            values: ['tag-1', 'tag'],
        });
        await db.database.connection.query({
            text: 'insert into strong_post_tags (post_id, tag_id) values (?, ?)',
            values: ['post-1', 'tag-1'],
        });
        await db.database.connection.query({
            text: 'insert into strong_comments (id, post_id, body) values (?, ?, ?)',
            values: ['comment-1', 'post-1', 'comment'],
        });

        const posts = await db.posts
            .include(post => post.tags)
            .include(post => post.comments.take(1))
            .toArray();

        expect(posts).toHaveLength(1);
        expect(posts[0]?.id.value).toBe('post-1');
        expect(posts[0]?.tags[0]?.id.value).toBe('tag-1');
        expect(posts[0]?.comments[0]?.post).toBe(posts[0]);
        expect(posts[0]?.comments[0]?.postId.value).toBe('post-1');

        db.changeTracker.clear();
        const comments = await db.comments
            .include(comment => comment.post)
            .toArray();
        expect(comments[0]?.post?.id.value).toBe('post-1');
        await expect(db.posts.find(new StrongId('post-1')))
            .resolves.toBe(comments[0]?.post);
        await db.dispose();
    });

    it('keeps concurrent lazy loads separate for strongly typed keys', async () => {
        const db = await open();
        await db.database.connection.query({
            text: 'insert into strong_posts (id, title) values (?, ?), (?, ?)',
            values: ['post-1', 'first', 'post-2', 'second'],
        });
        await db.database.connection.query({
            text: 'insert into strong_comments (id, post_id, body) values (?, ?, ?), (?, ?, ?)',
            values: [
                'comment-1', 'post-1', 'first comment',
                'comment-2', 'post-2', 'second comment',
            ],
        });
        const posts = await db.posts.orderBy(post => post.title).toArray();

        const [first, second] = await Promise.all([
            lazy(posts[0]).comments,
            lazy(posts[1]).comments,
        ]);

        expect(first.map(comment => comment.id)).toEqual(['comment-1']);
        expect(second.map(comment => comment.id)).toEqual(['comment-2']);
        expect(posts[0].comments).toBe(first);
        expect(posts[1].comments).toBe(second);
        await expect(lazy(posts[0]).tags).rejects.toThrow(/configured maximum/);
        await db.dispose();
    });

    it('preserves a private-field foreign-key reassignment', async () => {
        const db = await open();
        await db.database.connection.query({
            text: 'insert into strong_posts (id, title) values (?, ?), (?, ?)',
            values: ['post-1', 'first', 'post-2', 'second'],
        });
        await db.database.connection.query({
            text: 'insert into strong_comments (id, post_id, body) values (?, ?, ?)',
            values: ['comment-1', 'post-1', 'comment'],
        });
        const posts = await db.posts.orderBy(post => post.id).toArray();
        const comment = await db.comments
            .include(item => item.post)
            .single();

        comment.postId = new StrongId('post-2');

        await expect(db.saveChanges()).resolves.toBe(1);
        expect(comment.post).toBe(posts[1]);
        expect(comment.postId.value).toBe('post-2');
        const stored = await db.database.connection.query<{
            post_id: string;
        }>({
            text: 'select post_id from strong_comments where id = ?',
            values: ['comment-1'],
        });
        expect(stored.rows).toEqual([{ post_id: 'post-2' }]);
        await db.dispose();
    });

    it('orders a private-field key graph without a navigation', async () => {
        const db = await open();
        const post = Object.assign(new StrongPost(), {
            id: new StrongId('post-3'),
            title: 'post',
        });
        const comment = Object.assign(new StrongComment(), {
            id: 'comment-3',
            postId: new StrongId('post-3'),
            body: 'comment',
        });
        db.comments.add(comment);
        db.posts.add(post);

        expect(db.getSavePlan().map(entry => entry.entityName)).toEqual([
            'StrongPost',
            'StrongComment',
        ]);
        await expect(db.saveChanges()).resolves.toBe(2);
        const stored = await db.database.connection.query<{
            post_id: string;
        }>({
            text: 'select post_id from strong_comments where id = ?',
            values: ['comment-3'],
        });
        expect(stored.rows).toEqual([{ post_id: 'post-3' }]);
        await db.dispose();
    });

    it('fixes up converted relationships after reload', async () => {
        const db = await open();
        await db.database.connection.query({
            text: 'insert into strong_posts (id, title) values (?, ?), (?, ?)',
            values: ['post-1', 'first', 'post-2', 'second'],
        });
        await db.database.connection.query({
            text: 'insert into strong_comments (id, post_id, body) values (?, ?, ?)',
            values: ['comment-1', 'post-1', 'before'],
        });
        const posts = await db.posts.orderBy(post => post.id).toArray();
        const comment = await db.comments.include(item => item.post).single();
        const entry = db.entry(comment);
        if (!entry) throw new Error('Expected the comment to be tracked.');
        await db.database.connection.query({
            text: 'update strong_comments set post_id = ?, body = ? where id = ?',
            values: ['post-2', 'after', 'comment-1'],
        });

        await expect(entry.reload()).resolves.toBe(true);

        expect(comment.body).toBe('after');
        expect(comment.postId.value).toBe('post-2');
        expect(comment.post).toBe(posts[1]);
        expect(posts[0].comments).toEqual([]);
        expect(posts[1].comments).toEqual([comment]);
        await db.dispose();
    });

    it('cascades only through the matching converted principal key', async () => {
        const db = await open();
        await db.database.connection.query({
            text: 'insert into strong_posts (id, title) values (?, ?), (?, ?)',
            values: ['post-1', 'first', 'post-2', 'second'],
        });
        await db.database.connection.query({
            text: 'insert into strong_comments (id, post_id, body) values (?, ?, ?)',
            values: ['comment-1', 'post-1', 'comment'],
        });
        const posts = await db.posts.orderBy(post => post.id).toArray();
        const comment = await db.comments.include(item => item.post).single();

        db.posts.remove(posts[1]);
        db.changeTracker.detectChanges();

        expect(db.entry(comment)?.state).toBe('Unchanged');
        await expect(db.saveChanges()).resolves.toBe(1);
        const stored = await db.database.connection.query<{
            id: string;
            post_id: string;
        }>({
            text: 'select id, post_id from strong_comments',
            values: [],
        });
        expect(stored.rows).toEqual([{
            id: 'comment-1',
            post_id: 'post-1',
        }]);
        await db.dispose();
    });

    it('detects required orphans through converted relationship keys', async () => {
        const db = await open();
        await db.database.connection.query({
            text: 'insert into strong_posts (id, title) values (?, ?)',
            values: ['post-1', 'post'],
        });
        await db.database.connection.query({
            text: 'insert into strong_comments (id, post_id, body) values (?, ?, ?)',
            values: ['comment-1', 'post-1', 'comment'],
        });
        const post = await db.posts.include(item => item.comments).single();
        const comment = post.comments[0];

        post.comments.splice(0, 1);
        db.changeTracker.detectChanges();

        expect(db.entry(comment)?.state).toBe('Deleted');
        await expect(db.saveChanges()).resolves.toBe(1);
        const stored = await db.database.connection.query<{
            count: number;
        }>({
            text: 'select count(*) as count from strong_comments',
            values: [],
        });
        expect(stored.rows).toEqual([{ count: 0 }]);
        await db.dispose();
    });
});
