import type { DbContextOptionsBuilder, ModelBuilder } from '../../src';
import { DbContext } from '../../src';
import { sqliteProviderServices } from '../../src/providers/sqlite';
import { PausingSqliteConnection } from './nested-include-pause-support';
import { requireDefined } from './require-defined';

export class RacePost {
    public id = '';
    public title = '';
    public tags: RaceTag[] = [];
}

export class RaceTag {
    public id = '';
    public name = '';
    public posts: RacePost[] = [];
    public notes: RaceNote[] = [];
}

export class RaceNote {
    public id = '';
    public tagId = '';
    public tag: RaceTag | null = null;
}

/**
 * A many-to-many graph with one more level to hold open below the tag.
 *
 * The nesting is the point: the first include level publishes the navigation
 * under test and the second can be paused indefinitely, so a public `link()`,
 * `unlink()`, or accepted reference move lands on a live graph the load still
 * believes it owns.
 */
export class RaceContext extends DbContext {
    public readonly connection = new PausingSqliteConnection();
    public posts = this.set(RacePost);
    public tags = this.set(RaceTag);
    public notes = this.set(RaceNote);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(this.connection, {
            provider: 'sqlite',
            dialect: sqliteProviderServices.dialect,
            migrationDialect: sqliteProviderServices.migrationDialect,
            createMigrationBuilder:
                sqliteProviderServices.createMigrationBuilder,
            valueReader: sqliteProviderServices.valueReader,
        });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(RacePost, entity => {
            entity.toTable('race_posts');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.title)
                .hasColumnType('text').isRequired();
            entity.hasManyToMany(RaceTag, row => row.tags)
                .withMany(row => row.posts)
                .usingJoinTable('race_post_tags', join => {
                    join.sourceForeignKey('post_id');
                    join.targetForeignKey('tag_id');
                });
        });
        model.entity(RaceTag, entity => {
            entity.toTable('race_tags');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.name)
                .hasColumnType('text').isRequired();
        });
        model.entity(RaceNote, entity => {
            entity.toTable('race_notes');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.tagId).hasColumnName('tag_id')
                .hasColumnType('text').isRequired();
            entity.hasOne(RaceTag, row => row.tag)
                .withMany(row => row.notes)
                .hasForeignKey(row => row.tagId);
        });
    }
}

/** One post, two tags, one note under the first tag, and no join rows yet. */
export async function openRaceGraph(): Promise<RaceContext> {
    const db = RaceContext.create();
    for (const statement of [
        { text: db.database.createScript(), values: [] },
        {
            text: 'insert into race_posts (id, title) values (?, ?)',
            values: ['post_1', 'Hello'],
        },
        {
            text: 'insert into race_tags (id, name) values (?, ?), (?, ?)',
            values: ['tag_1', 'TypeScript', 'tag_2', 'Postgres'],
        },
        {
            text: 'insert into race_notes (id, tag_id) values (?, ?)',
            values: ['note_1', 'tag_1'],
        },
    ]) await db.database.connection.query(statement);
    return db;
}

/** Insert a join row behind the change tracker's back. */
export async function insertRaceJoinRow(
    db: RaceContext,
    postId: string,
    tagId: string,
): Promise<void> {
    await db.connection.query({
        text: 'insert into race_post_tags (post_id, tag_id) values (?, ?)',
        values: [postId, tagId],
    });
}

/**
 * Read the join table straight off the connection, in a stable order.
 *
 * Deliberately not through `db.database`: a poisoned context refuses that
 * facade, and what these tests need to know is what the *database* holds once
 * the context has stopped answering.
 */
export async function storedRaceJoinRows(
    db: RaceContext,
): Promise<string[]> {
    const result = await db.connection.query<{
        post_id: string; tag_id: string;
    }>({
        text: `select post_id, tag_id from race_post_tags
            order by post_id, tag_id`,
        values: [],
    });
    return result.rows.map(row => `${row.post_id}->${row.tag_id}`);
}

/** A nested include held open after its first level published a navigation. */
export interface PausedRaceLoad<TEntity> {
    readonly db: RaceContext;
    /** The entity whose navigation the held load has already written. */
    readonly entity: TEntity;
    /** The related entity the load stitched in. */
    readonly first: RaceTag;
    /** The related entity a newer public operation moves to. */
    readonly second: RaceTag;
    readonly loading: Promise<unknown>;
}

/**
 * Stitch `post.tags` from the join table, then hold the nested note query.
 *
 * `preloadTags` decides what the journal captured as the previous value: an
 * empty collection the load is filling for the first time, or the collection an
 * earlier successful load already published.
 */
export async function pauseAfterTagStitch(
    preloadTags = false,
): Promise<PausedRaceLoad<RacePost>> {
    const db = await openRaceGraph();
    await insertRaceJoinRow(db, 'post_1', 'tag_1');
    const post = requireDefined(await db.posts.find('post_1'));
    const first = requireDefined(await db.tags.find('tag_1'));
    const second = requireDefined(await db.tags.find('tag_2'));
    if (preloadTags) await db.posts.include(row => row.tags).toArray();
    const reached = db.connection.pauseOn('race_notes');
    const loading = db.posts
        .include(row => row.tags)
        .thenInclude(row => row.notes)
        .toArray();
    await reached;
    return { db, entity: post, first, second, loading };
}

/** Stitch `note.tag`, then hold the nested many-to-many query below it. */
export async function pauseAfterTagReferenceStitch():
Promise<PausedRaceLoad<RaceNote>> {
    const db = await openRaceGraph();
    const note = requireDefined(await db.notes.find('note_1'));
    const first = requireDefined(await db.tags.find('tag_1'));
    const second = requireDefined(await db.tags.find('tag_2'));
    const reached = db.connection.pauseOn('race_post_tags');
    const loading = db.notes
        .include(row => row.tag)
        .thenInclude(row => row.posts)
        .toArray();
    await reached;
    return { db, entity: note, first, second, loading };
}
