import {
    GeneratedPost,
    GeneratedTag,
    startGeneratedManyToManyContext,
} from './support/generated-many-to-many-context';

describe('generated many-to-many endpoint keys', () => {
    it('links hydrated keys instead of existing zero rows', async () => {
        const db = await startGeneratedManyToManyContext();
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
        const db = await startGeneratedManyToManyContext();
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

    it('expires placeholders before a later relationship save', async () => {
        const db = await startGeneratedManyToManyContext();
        const post = Object.assign(new GeneratedPost(), { title: 'later-post' });
        const tag = Object.assign(new GeneratedTag(), { name: 'later-tag' });
        db.posts.add(post);
        db.tags.add(tag);
        await expect(db.saveChanges()).resolves.toBe(2);

        db.link(post, item => item.tags, tag);
        await expect(db.saveChanges()).resolves.toBe(0);

        const rows = await db.database.connection.query<{
            post_id: number;
            tag_id: number;
        }>({
            text: 'select post_id, tag_id from generated_post_tags',
            values: [],
        });
        expect(rows.rows).toEqual([{ post_id: post.id, tag_id: tag.id }]);
        await db.dispose();
    });
});
