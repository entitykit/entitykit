import {
    GeneratedPost,
    GeneratedTag,
    startGeneratedManyToManyContext,
} from './support/generated-many-to-many-context';

describe('generated key placeholder contract', () => {
    it.each([
        ['undefined', undefined],
        ['null', null],
        ['empty string', ''],
    ] as const)('links %s generated endpoints in one save', async (
        _label,
        placeholder,
    ) => {
        const db = await startGeneratedManyToManyContext();
        const post = Object.assign(new GeneratedPost(), {
            id: placeholder as unknown as number,
            title: 'new-post',
        });
        const tag = Object.assign(new GeneratedTag(), {
            id: placeholder as unknown as number,
            name: 'new-tag',
        });
        db.posts.add(post);
        db.tags.add(tag);
        db.link(post, item => item.tags, tag);

        await expect(db.saveChanges()).resolves.toBe(2);

        expect(post.id).toBe(1);
        expect(tag.id).toBe(1);
        const result = await db.database.connection.query<{
            post_id: number;
            tag_id: number;
        }>({
            text: 'select post_id, tag_id from generated_post_tags',
            values: [],
        });
        expect(result.rows).toEqual([{ post_id: 1, tag_id: 1 }]);
        await db.dispose();
    });

    it.each([55, -1])('saves repeated explicit %s placeholders', async id => {
        const db = await startGeneratedManyToManyContext();
        const first = Object.assign(new GeneratedPost(), { id, title: 'first' });
        const second = Object.assign(new GeneratedPost(), { id, title: 'second' });

        expect(() => {
            db.posts.add(first);
            db.posts.add(second);
        }).not.toThrow();
        await expect(db.saveChanges()).resolves.toBe(2);

        expect([first.id, second.id]).toEqual([1, 2]);
        const result = await db.database.connection.query<{ id: number }>({
            text: 'select id from generated_posts where id > 0 order by id',
            values: [],
        });
        expect(result.rows).toEqual([{ id: 1 }, { id: 2 }]);
        await db.dispose();
    });
});
