import {
    GeneratedPost,
    GeneratedTag,
    startGeneratedManyToManyContext,
} from './support/generated-many-to-many-context';
import type { SavePlanEntry } from '../src';

function relationshipEntry(
    plan: readonly SavePlanEntry[],
): SavePlanEntry {
    const entry = plan.find(candidate => candidate.isSystemGenerated);
    if (!entry) {
        throw new Error('Expected a generated relationship save-plan entry.');
    }
    return entry;
}

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
        const observedPlans: Array<readonly SavePlanEntry[]> = [];
        const db = await startGeneratedManyToManyContext({
            savingChanges: event => {
                observedPlans.push(event.plan);
            },
            savedChanges: event => {
                observedPlans.push(event.plan);
            },
        });
        const first = Object.assign(new GeneratedPost(), { title: 'first' });
        const second = Object.assign(new GeneratedPost(), { title: 'second' });
        const tag = Object.assign(new GeneratedTag(), { name: 'shared' });
        db.posts.add(first);
        db.posts.add(second);
        db.tags.add(tag);
        db.link(first, item => item.tags, tag);
        db.link(second, item => item.tags, tag);

        const preview = relationshipEntry(db.getSavePlan());
        expect(preview).toMatchObject({
            relationshipChangeCount: 2,
            isDeferred: true,
        });
        expect(preview.statement.text).toContain(
            'values (?, ?), (?, ?)',
        );
        expect(preview.statement.values).toEqual([0, 0, 0, 0]);
        expect(preview.relationshipPairs).toEqual([
            { source: first, target: tag },
            { source: second, target: tag },
        ]);
        expect(Object.isFrozen(preview.relationshipPairs)).toBe(true);
        expect(Object.isFrozen(preview.relationshipPairs?.[0])).toBe(true);
        expect(db.getSavePlanDebugView()).toContain(
            'relationships: 2 (deferred)',
        );

        await expect(db.saveChanges()).resolves.toBe(3);

        expect(observedPlans).toHaveLength(2);
        for (const plan of observedPlans) {
            const relationship = relationshipEntry(plan);
            expect(relationship.relationshipPairs).toHaveLength(2);
            expect(relationship.relationshipChangeCount).toBe(2);
            expect(relationship.statement.values).toHaveLength(4);
            expect(relationship.isDeferred).toBe(true);
        }

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
