import { requireDefined } from './support/require-defined';
import type {
    DbContextOptionsBuilder,
    ModelBuilder,
    ValueConverter,
} from '../src';
import { DbContext, valueConverter } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';

/**
 * Identity keys, join-table columns, and query parameters each need a key in a
 * particular form. When a key property configures a converter those forms
 * differ, which is what these tests pin: the database stores a bare id while
 * the model uses a prefixed one.
 */
const prefixedId = (prefix: string): ValueConverter<string, string> => valueConverter<string, string>({
    toProvider(value) {
        return value.startsWith(prefix) ? value.slice(prefix.length) : value;
    },
    fromProvider(value) {
        return `${prefix}${value}`;
    },
});

class Post {
    public id!: string;
    public title!: string;
    public tags?: Tag[];

    constructor(data?: Partial<Post>) {
        Object.assign(this, data);
    }
}

class Tag {
    public id!: string;
    public name!: string;
    public posts?: Post[];

    constructor(data?: Partial<Tag>) {
        Object.assign(this, data);
    }
}

class BlogContext extends DbContext {
    public posts = this.set(Post);
    public tags = this.set(Tag);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Post, entity => {
            entity.toTable('posts');
            entity.hasKey(post => post.id);
            entity.property(post => post.id).hasColumnName('id').hasColumnType('text').isRequired().hasConversion(prefixedId('post_'));
            entity.property(post => post.title).hasColumnName('title').hasColumnType('text').isRequired();
            entity.hasManyToMany(Tag, post => post.tags)
                .withMany(tag => tag.posts)
                .usingJoinTable('post_tags', join => {
                    join.sourceForeignKey('post_id');
                    join.targetForeignKey('tag_id');
                });
        });

        model.entity(Tag, entity => {
            entity.toTable('tags');
            entity.hasKey(tag => tag.id);
            entity.property(tag => tag.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(tag => tag.name).hasColumnName('name').hasColumnType('text').isRequired();
        });
    }
}

async function createBlogDb(): Promise<BlogContext> {
    const db = BlogContext.create();
    await db.database.connection.query({ text: db.database.createScript(), values: [] });
    return db;
}

describe('entities whose key property configures a converter', () => {
    let db: BlogContext;

    beforeEach(async () => {
        db = await createBlogDb();
        db.posts.add(new Post({ id: 'post_1', title: 'Hello' }));
        db.tags.add(new Tag({ id: 'tag_1', name: 'news' }));
        await db.saveChanges();
        db.changeTracker.clear();
    });

    afterEach(async () => {
        await db.dispose();
    });

    it('stores the key in its provider form', async () => {
        const rows = await db.database.connection.query<{ id: string }>({ text: 'select "id" from "posts"', values: [] });
        expect(rows.rows[0].id).toBe('1');
    });

    it('returns the same tracked instance when a row is read twice', async () => {
        const first = await db.posts.find('post_1');
        const second = await db.posts.find('post_1');

        // The identity map is keyed by the model value; a lookup that used the raw
        // row value would miss and build a second, untracked instance.
        expect(first).toBe(second);
        expect(db.changeTracker.entries()).toHaveLength(1);
        expect(db.changeTracker.entry(requireDefined(second))).toBeDefined();
    });

    it('persists an edit made to an entity read more than once', async () => {
        await db.posts.find('post_1');
        const reread = await db.posts.find('post_1');

        requireDefined(reread).title = 'Changed';
        await expect(db.saveChanges()).resolves.toBe(1);

        db.changeTracker.clear();
        const reloaded = await db.posts.find('post_1');
        expect(requireDefined(reloaded).title).toBe('Changed');
    });

    it('loads a many-to-many include', async () => {
        await db.database.connection.query({
            text: 'insert into "post_tags" ("post_id", "tag_id") values (?, ?)',
            values: ['1', 'tag_1'],
        });

        const posts = await db.posts.include(post => post.tags).toArray();

        expect(posts[0].id).toBe('post_1');
        expect(requireDefined(posts[0].tags).map(tag => tag.id)).toEqual(['tag_1']);
    });

    it('writes join-table rows in the provider form, so link round-trips', async () => {
        const post = await db.posts.find('post_1');
        const tag = await db.tags.find('tag_1');

        db.link(requireDefined(post), entity => entity.tags, requireDefined(tag));
        await db.saveChanges();

        // The join column is a foreign key to posts.id, which stores "1".
        const joinRows = await db.database.connection.query<{ post_id: string; tag_id: string }>({
            text: 'select "post_id", "tag_id" from "post_tags"',
            values: [],
        });
        expect(joinRows.rows).toEqual([{ post_id: '1', tag_id: 'tag_1' }]);

        db.changeTracker.clear();
        const reloaded = await db.posts.include(entity => entity.tags).toArray();
        expect(requireDefined(reloaded[0].tags).map(entity => entity.id)).toEqual(['tag_1']);
    });

    it('unlinks using the same key form it linked with', async () => {
        const post = await db.posts.find('post_1');
        const tag = await db.tags.find('tag_1');
        db.link(requireDefined(post), entity => entity.tags, requireDefined(tag));
        await db.saveChanges();

        db.unlink(requireDefined(post), entity => entity.tags, requireDefined(tag));
        await db.saveChanges();

        const joinRows = await db.database.connection.query({ text: 'select * from "post_tags"', values: [] });
        expect(joinRows.rows).toEqual([]);
    });
});
