import { EntityState } from '../src';
import { requireDefined } from './support/require-defined';
import type {
    LinkPost,
    LinkRefusalContext,
    LinkTag,
} from './support/link-refusal-support';
import {
    insertJoinRow,
    interceptTags,
    makeTagsGetterOnly,
    refusal,
    storedJoinRows,
    trackedLinkGraph,
} from './support/link-refusal-support';

/** The tracker must not claim the source entity changed behind a link. */
function expectCleanBaseline(db: LinkRefusalContext, post: LinkPost): void {
    const entry = requireDefined(db.entry(post));
    expect(entry.state).toBe(EntityState.Unchanged);
    expect(entry.modifiedProperties()).toEqual([]);
}

describe('accessor refusal across many-to-many link operations', () => {
    it('links into a frozen readonly collection and persists the join row', async () => {
        const { db, post, first } = await trackedLinkGraph();
        const frozen = Object.freeze([]) as unknown as LinkTag[];
        post.tags = frozen;

        db.link(post, row => row.tags, first);

        expect(post.tags).not.toBe(frozen);
        expect(Object.isFrozen(post.tags)).toBe(false);
        expect(post.tags).toEqual([first]);
        expect(db.getSavePlanDebugView()).toContain('LinkPost.tags');
        expectCleanBaseline(db, post);
        await expect(db.saveChanges()).resolves.toBe(0);
        await expect(storedJoinRows(db)).resolves.toEqual(['post_1->tag_1']);
        await db.dispose();
    });

    it('unlinks out of a frozen readonly collection and deletes the join row', async () => {
        const { db, post, first } = await trackedLinkGraph();
        await insertJoinRow(db, 'post_1', 'tag_1');
        post.tags = Object.freeze([first]) as unknown as LinkTag[];

        db.unlink(post, row => row.tags, first);

        expect(Object.isFrozen(post.tags)).toBe(false);
        expect(post.tags).toEqual([]);
        await expect(db.saveChanges()).resolves.toBe(0);
        await expect(storedJoinRows(db)).resolves.toEqual([]);
        await db.dispose();
    });

    it('leaves a getter-only collection link inspectable and usable', async () => {
        const { db, post, first } = await trackedLinkGraph();
        const connection = db.database.connection;
        const live: LinkTag[] = [];
        makeTagsGetterOnly(post, live);
        const planBefore = db.getSavePlanDebugView();

        const failure = refusal(() => {
            db.link(post, row => row.tags, first);
        });

        expect(failure).toBeInstanceOf(TypeError);
        expect((failure as Error).message).toContain('only a getter');
        expect(post.tags).toBe(live);
        expect(post.tags).toEqual([]);
        expect(db.getSavePlan()).toEqual([]);
        expect(db.getSavePlanDebugView()).toBe(planBefore);
        expectCleanBaseline(db, post);
        await expect(db.saveChanges()).resolves.toBe(0);
        const rows = await connection.query({
            text: 'select post_id from link_post_tags', values: [],
        });
        expect(rows.rows).toEqual([]);
        await expect(storedJoinRows(db)).resolves.toEqual([]);
        await expect(db.posts.count()).resolves.toBe(1);
        await db.dispose();
    });

    it('queues nothing when a collection setter refuses a link', async () => {
        const { db, post, first } = await trackedLinkGraph();
        const log: string[] = [];
        interceptTags(post, () => [], log);
        const planBefore = db.getSavePlanDebugView();

        const failure = refusal(() => {
            db.link(post, row => row.tags, first);
        });

        expect((failure as Error).message).toBe(
            'Navigation \'LinkPost.tags\' refused its assigned value.',
        );
        expect(post.tags).toEqual([]);
        expect(log).toEqual(['tags=tag_1', 'tags=']);
        expect(db.getSavePlan()).toEqual([]);
        expect(db.getSavePlanDebugView()).toBe(planBefore);
        expectCleanBaseline(db, post);
        await expect(db.saveChanges()).resolves.toBe(0);
        await expect(storedJoinRows(db)).resolves.toEqual([]);
        await expect(db.posts.count()).resolves.toBe(1);
        await db.dispose();
    });

    it('keeps the stored join row when a collection setter refuses an unlink', async () => {
        const { db, post, first } = await trackedLinkGraph();
        await insertJoinRow(db, 'post_1', 'tag_1');
        post.tags = [first];
        const log: string[] = [];
        interceptTags(post, () => [first], log);

        const failure = refusal(() => {
            db.unlink(post, row => row.tags, first);
        });

        expect((failure as Error).message).toBe(
            'Navigation \'LinkPost.tags\' refused its assigned value.',
        );
        expect(post.tags).toEqual([first]);
        expect(log).toEqual(['tags=', 'tags=tag_1']);
        expect(db.getSavePlan()).toEqual([]);
        expectCleanBaseline(db, post);
        await expect(db.saveChanges()).resolves.toBe(0);
        await expect(storedJoinRows(db)).resolves.toEqual(['post_1->tag_1']);
        await expect(db.posts.count()).resolves.toBe(1);
        await db.dispose();
    });

    it('cancels only the refused link and keeps the earlier queued one', async () => {
        const { db, post, first, second } = await trackedLinkGraph();
        db.link(post, row => row.tags, first);
        interceptTags(post, () => [first]);

        const failure = refusal(() => {
            db.link(post, row => row.tags, second);
        });

        expect((failure as Error).message).toBe(
            'Navigation \'LinkPost.tags\' refused its assigned value.',
        );
        expect(post.tags).toEqual([first]);
        expect(db.getSavePlan()).toHaveLength(1);
        expect(db.getSavePlanDebugView()).toContain('relationships: 1');
        expect(db.getSavePlanDebugView()).toContain('post_1->tag_1');
        expect(db.getSavePlanDebugView()).not.toContain('post_1->tag_2');
        await expect(db.saveChanges()).resolves.toBe(0);
        await expect(storedJoinRows(db)).resolves.toEqual(['post_1->tag_1']);
        await db.dispose();
    });

    it('leaves an unrelated pending scalar change untouched by a refused link', async () => {
        const { db, post, first, second } = await trackedLinkGraph();
        second.name = 'renamed';
        const planBefore = db.getSavePlanDebugView();
        const entriesBefore = db.getSavePlan().length;
        interceptTags(post, () => []);

        refusal(() => {
            db.link(post, row => row.tags, first);
        });

        expect(db.getSavePlanDebugView()).toBe(planBefore);
        expect(db.getSavePlan()).toHaveLength(entriesBefore);
        expect(planBefore).toContain('LinkTag { "tag_2" } Modified');
        expect(planBefore).not.toContain('LinkPost.tags');
        await expect(db.saveChanges()).resolves.toBe(1);
        await expect(storedJoinRows(db)).resolves.toEqual([]);
        const renamed = await db.database.connection.query<{ name: string }>({
            text: 'select name from link_tags where id = ?', values: ['tag_2'],
        });
        expect(renamed.rows.map(row => row.name)).toEqual(['renamed']);
        await db.dispose();
    });
});
