import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, valueConverter } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';

class StrongKey {
    readonly #value: string;

    constructor(value: string) {
        this.#value = value;
    }

    public get value(): string {
        return this.#value;
    }
}

const strongKeyConverter = valueConverter<StrongKey, string>({
    toProvider: value => value.value,
    fromProvider: value => new StrongKey(value),
});

class CrossTypePost {
    public id!: StrongKey;
    public title = '';
    public comments: CrossTypeComment[] = [];
}

class CrossTypeComment {
    public id = '';
    public postId = '';
    public body = '';
    public post?: CrossTypePost;
}

class CrossTypeRelationshipContext extends DbContext {
    public posts = this.set(CrossTypePost);
    public comments = this.set(CrossTypeComment);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(CrossTypePost, entity => {
            entity.toTable('cross_type_posts');
            entity.hasKey(post => post.id);
            entity.property(post => post.id).hasColumnType('text')
                .hasConversion(strongKeyConverter).isRequired();
            entity.property(post => post.title).hasColumnType('text').isRequired();
        });
        model.entity(CrossTypeComment, entity => {
            entity.toTable('cross_type_comments');
            entity.hasKey(comment => comment.id);
            entity.property(comment => comment.id).hasColumnType('text').isRequired();
            entity.property(comment => comment.postId).hasColumnName('post_id')
                .hasColumnType('text').isRequired();
            entity.property(comment => comment.body).hasColumnType('text').isRequired();
            entity.hasOne(CrossTypePost, comment => comment.post)
                .withMany(post => post.comments)
                .hasForeignKey(comment => comment.postId);
        });
    }
}

async function open(): Promise<CrossTypeRelationshipContext> {
    const db = CrossTypeRelationshipContext.create();
    await db.database.connection.query({
        text: db.database.createScript(),
        values: [],
    });
    return db;
}

describe('cross-model converted relationship keys', () => {
    it('orders, loads, and fixes up through the provider representation', async () => {
        const db = await open();
        const first = Object.assign(new CrossTypePost(), {
            id: new StrongKey('post-1'),
            title: 'first',
        });
        const comment = Object.assign(new CrossTypeComment(), {
            id: 'comment-1',
            postId: 'post-1',
            body: 'comment',
        });
        db.comments.add(comment);
        db.posts.add(first);

        expect(db.getSavePlan().map(entry => entry.entityName)).toEqual([
            'CrossTypePost',
            'CrossTypeComment',
        ]);
        await expect(db.saveChanges()).resolves.toBe(2);
        db.changeTracker.clear();

        const loaded = await db.comments.include(item => item.post).single();
        expect(loaded.post?.id.value).toBe('post-1');
        expect(loaded.postId).toBe('post-1');

        const second = Object.assign(new CrossTypePost(), {
            id: new StrongKey('post-2'),
            title: 'second',
        });
        db.posts.add(second);
        await db.saveChanges();
        loaded.post = second;

        await expect(db.saveChanges()).resolves.toBe(1);
        expect(loaded.postId).toBe('post-2');
        const stored = await db.database.connection.query<{
            post_id: string;
        }>({
            text: 'select post_id from cross_type_comments where id = ?',
            values: ['comment-1'],
        });
        expect(stored.rows).toEqual([{ post_id: 'post-2' }]);
        await db.dispose();
    });
});
