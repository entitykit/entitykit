import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext, EntityState } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { requireDefined } from './support/require-defined';
import { refusalMessage, rejection } from './support/accessor-refusal-support';

class ProvenanceAuthor {
    public id = '';
    public posts: ProvenancePost[] = [];
}

class ProvenancePost {
    public id = '';
    public authorId = '';
    public author: ProvenanceAuthor | null = null;
    public tags: ProvenanceTag[] = [];
}

class ProvenanceTag {
    public id = '';
    public posts: ProvenancePost[] = [];
}

/** SQLite graph whose principal table can be dropped behind a pending load. */
class ProvenanceContext extends DbContext {
    public authors = this.set(ProvenanceAuthor);
    public posts = this.set(ProvenancePost);
    public tags = this.set(ProvenanceTag);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(ProvenanceAuthor, entity => {
            entity.toTable('provenance_authors');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
        });
        model.entity(ProvenanceTag, entity => {
            entity.toTable('provenance_tags');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
        });
        model.entity(ProvenancePost, entity => {
            entity.toTable('provenance_posts');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.authorId)
                .hasColumnName('author_id')
                .hasColumnType('text').isRequired();
            entity.hasOne(ProvenanceAuthor, row => row.author)
                .withMany(row => row.posts)
                .hasForeignKey(row => row.authorId);
            entity.hasManyToMany(ProvenanceTag, row => row.tags)
                .withMany(row => row.posts)
                .usingJoinTable('provenance_post_tags', join => {
                    join.sourceForeignKey('post_id');
                    join.targetForeignKey('tag_id');
                });
        });
    }
}

/** One author owning one post, plus two unrelated tag rows. */
async function openProvenanceGraph(): Promise<ProvenanceContext> {
    const db = ProvenanceContext.create();
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    await db.database.connection.query({
        text: 'insert into provenance_authors (id) values (?)',
        values: ['a1'],
    });
    await db.database.connection.query({
        text: 'insert into provenance_posts (id, author_id) values (?, ?)',
        values: ['p1', 'a1'],
    });
    await db.database.connection.query({
        text: 'insert into provenance_tags (id) values (?), (?)',
        values: ['t1', 't2'],
    });
    return db;
}

/** Take the principal table away so the next reference load fails in the provider. */
async function dropAuthorsTable(db: ProvenanceContext): Promise<void> {
    for (const text of [
        'pragma foreign_keys = OFF',
        'drop table provenance_authors',
        'pragma foreign_keys = ON',
    ]) {
        await db.database.connection.query({ text, values: [] });
    }
}

/** Read the tag table directly, in a stable order. */
async function storedTagIds(db: ProvenanceContext): Promise<string[]> {
    const result = await db.database.connection.query<{ id: string }>({
        text: 'select id from provenance_tags order by id', values: [],
    });
    return result.rows.map(row => row.id);
}

/** Read the join table directly, as `post->tag` pairs in a stable order. */
async function storedJoinRows(db: ProvenanceContext): Promise<string[]> {
    const result = await db.database.connection.query<{
        post_id: string; tag_id: string;
    }>({
        text: `select post_id, tag_id from provenance_post_tags
            order by post_id, tag_id`,
        values: [],
    });
    return result.rows.map(row => `${row.post_id}->${row.tag_id}`);
}

describe('navigation load tracking provenance', () => {
    it('keeps an entity added while a failed load was still pending', async () => {
        const db = await openProvenanceGraph();
        const post = requireDefined(await db.posts.find('p1'));
        const entry = requireDefined(db.entry(post));
        await dropAuthorsTable(db);

        const loading = entry.reference(row => row.author).load();
        const added = new ProvenanceTag();
        added.id = 't3';
        db.tags.add(added);
        const failure = await rejection(async () => loading);

        expect(refusalMessage(failure)).toContain('no such table');
        // The add() reported success before the load failed; an unrelated query
        // failure is not allowed to take it back out of the unit of work.
        expect(db.entry(added)).toBeDefined();
        expect(requireDefined(db.entry(added)).state).toBe(EntityState.Added);
        await expect(db.saveChanges()).resolves.toBe(1);
        await expect(storedTagIds(db)).resolves.toEqual(['t1', 't2', 't3']);
        expect(requireDefined(db.entry(added)).state)
            .toBe(EntityState.Unchanged);
        await expect(db.tags.count()).resolves.toBe(3);
        await db.dispose();
    });

    it('keeps an attached entity and its queued link across a failed load', async () => {
        const db = await openProvenanceGraph();
        const post = requireDefined(await db.posts.find('p1'));
        const entry = requireDefined(db.entry(post));
        await dropAuthorsTable(db);

        const loading = entry.reference(row => row.author).load();
        const attached = new ProvenanceTag();
        attached.id = 't2';
        db.tags.attach(attached);
        db.link(post, row => row.tags, attached);
        await rejection(async () => loading);

        expect(db.entry(attached)).toBeDefined();
        expect(requireDefined(db.entry(attached)).state)
            .toBe(EntityState.Unchanged);
        // Detaching the target would have cancelled the queued join row with it.
        await expect(db.saveChanges()).resolves.toBe(0);
        await expect(storedJoinRows(db)).resolves.toEqual(['p1->t2']);
        await db.dispose();
    });
});
