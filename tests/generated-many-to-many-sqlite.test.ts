import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';

class GeneratedPost {
    public id = 0;
    public title = '';
    public tags: GeneratedTag[] = [];
}

class GeneratedTag {
    public id = 0;
    public name = '';
    public posts: GeneratedPost[] = [];
}

class GeneratedManyToManyContext extends DbContext {
    public posts = this.set(GeneratedPost);
    public tags = this.set(GeneratedTag);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(GeneratedPost, entity => {
            entity.toTable('generated_posts');
            entity.hasKey(post => post.id);
            entity.property(post => post.id).hasColumnType('integer')
                .isRequired().useSqliteRowId();
            entity.property(post => post.title).hasColumnType('text').isRequired();
            entity.hasManyToMany(GeneratedTag, post => post.tags)
                .withMany(tag => tag.posts)
                .usingJoinTable('generated_post_tags', join => {
                    join.sourceForeignKey('post_id');
                    join.targetForeignKey('tag_id');
                });
        });
        model.entity(GeneratedTag, entity => {
            entity.toTable('generated_tags');
            entity.hasKey(tag => tag.id);
            entity.property(tag => tag.id).hasColumnType('integer')
                .isRequired().useSqliteRowId();
            entity.property(tag => tag.name).hasColumnType('text').isRequired();
        });
    }
}

async function start(): Promise<GeneratedManyToManyContext> {
    const db = GeneratedManyToManyContext.create();
    await db.database.connection.query({
        text: db.database.createScript(),
        values: [],
    });
    await db.database.connection.query({
        text: 'insert into generated_posts (id, title) values (?, ?)',
        values: [0, 'existing-post'],
    });
    await db.database.connection.query({
        text: 'insert into generated_tags (id, name) values (?, ?)',
        values: [0, 'existing-tag'],
    });
    return db;
}

describe('generated many-to-many endpoint keys', () => {
    it('links hydrated keys instead of existing zero rows', async () => {
        const db = await start();
        const post = Object.assign(new GeneratedPost(), { title: 'new-post' });
        const tag = Object.assign(new GeneratedTag(), { name: 'new-tag' });
        db.posts.add(post);
        db.tags.add(tag);
        db.link(post, item => item.tags, tag);

        await expect(db.saveChanges()).resolves.toBe(2);

        expect(post.id).toBe(1);
        expect(tag.id).toBe(1);
        const rows = await db.database.connection.query<{
            post_id: number;
            tag_id: number;
        }>({
            text: 'select post_id, tag_id from generated_post_tags',
            values: [],
        });
        expect(rows.rows).toEqual([{ post_id: 1, tag_id: 1 }]);
        await db.dispose();
    });

    it('keeps distinct links that share zero placeholders', async () => {
        const db = await start();
        const first = Object.assign(new GeneratedPost(), { title: 'first' });
        const second = Object.assign(new GeneratedPost(), { title: 'second' });
        const tag = Object.assign(new GeneratedTag(), { name: 'shared' });
        db.posts.add(first);
        db.posts.add(second);
        db.tags.add(tag);
        db.link(first, item => item.tags, tag);
        db.link(second, item => item.tags, tag);

        await expect(db.saveChanges()).resolves.toBe(3);

        expect(first.id).not.toBe(second.id);
        const rows = await db.database.connection.query<{
            post_id: number;
            tag_id: number;
        }>({
            text: 'select post_id, tag_id from generated_post_tags order by post_id',
            values: [],
        });
        expect(rows.rows).toEqual([
            { post_id: first.id, tag_id: tag.id },
            { post_id: second.id, tag_id: tag.id },
        ]);
        await db.dispose();
    });
});
