import type { DbContextOptionsBuilder, ModelBuilder } from '../../packages/core/src';
import { DbContext } from '../../packages/core/src';
import { sqliteProviderServices } from '../../packages/sqlite/src';
import { requireDefined } from './require-defined';

export class LinkTag {
    public id = '';
    public name = '';
    public posts: LinkPost[] = [];
}

export class LinkPost {
    public id = '';
    public title = '';
    public tags: LinkTag[] = [];
}

/** SQLite-backed many-to-many graph shared by the link refusal matrix. */
export class LinkRefusalContext extends DbContext {
    public posts = this.set(LinkPost);
    public tags = this.set(LinkTag);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(LinkPost, entity => {
            entity.toTable('link_posts');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.title)
                .hasColumnType('text').isRequired();
            entity.hasManyToMany(LinkTag, row => row.tags)
                .withMany(row => row.posts)
                .usingJoinTable('link_post_tags', join => {
                    join.sourceForeignKey('post_id');
                    join.targetForeignKey('tag_id');
                });
        });
        model.entity(LinkTag, entity => {
            entity.toTable('link_tags');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.name)
                .hasColumnType('text').isRequired();
        });
    }
}

/** One tracked post with two tracked tags and no join rows yet. */
export interface TrackedLinkGraph {
    readonly db: LinkRefusalContext;
    readonly post: LinkPost;
    readonly first: LinkTag;
    readonly second: LinkTag;
}

/** Create the join schema with one post and two tags. */
export async function openLinkGraph(): Promise<LinkRefusalContext> {
    const db = LinkRefusalContext.create();
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    await db.database.connection.query({
        text: 'insert into link_posts (id, title) values (?, ?)',
        values: ['post_1', 'Hello'],
    });
    await db.database.connection.query({
        text: 'insert into link_tags (id, name) values (?, ?), (?, ?)',
        values: ['tag_1', 'TypeScript', 'tag_2', 'Postgres'],
    });
    return db;
}

/** Load the post and both tags into the change tracker. */
export async function trackedLinkGraph(): Promise<TrackedLinkGraph> {
    const db = await openLinkGraph();
    const post = requireDefined(await db.posts.find('post_1'));
    const first = requireDefined(await db.tags.find('tag_1'));
    const second = requireDefined(await db.tags.find('tag_2'));
    return { db, post, first, second };
}

/** Insert a join row behind the change tracker's back. */
export async function insertJoinRow(
    db: LinkRefusalContext,
    postId: string,
    tagId: string,
): Promise<void> {
    await db.database.connection.query({
        text: 'insert into link_post_tags (post_id, tag_id) values (?, ?)',
        values: [postId, tagId],
    });
}

/** Read the join table directly, as `post->tag` pairs in a stable order. */
export async function storedJoinRows(
    db: LinkRefusalContext,
): Promise<string[]> {
    const result = await db.database.connection.query<{
        post_id: string; tag_id: string;
    }>({
        text: `select post_id, tag_id from link_post_tags
            order by post_id, tag_id`,
        values: [],
    });
    return result.rows.map(row => `${row.post_id}->${row.tag_id}`);
}

/** Replace a post's collection with an accessor that keeps what it likes. */
export function interceptTags(
    post: LinkPost,
    store: (value: LinkTag[]) => LinkTag[],
    log?: string[],
): void {
    let stored = post.tags;
    Object.defineProperty(post, 'tags', {
        configurable: true,
        enumerable: true,
        get: () => stored,
        set: (value: LinkTag[]) => {
            log?.push(`tags=${value.map(row => row.id).join(',')}`);
            stored = store(value);
        },
    });
}

/** Replace a post's collection with a navigation that has no setter at all. */
export function makeTagsGetterOnly(post: LinkPost, value: LinkTag[]): void {
    Object.defineProperty(post, 'tags', {
        configurable: true,
        enumerable: true,
        get: () => value,
    });
}

/** Capture the value a synchronous operation throws, failing when it does not. */
export function refusal(action: () => void): unknown {
    let threw = false;
    let reason: unknown;
    try {
        action();
    } catch (error) {
        threw = true;
        reason = error;
    }
    expect(threw).toBe(true);
    return reason;
}
