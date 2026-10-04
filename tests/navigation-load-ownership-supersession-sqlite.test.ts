/**
 * The ownership-side mirror of `navigation-load-supersession-sqlite`.
 *
 * That suite proves a failed load refuses to overwrite a *navigation* a newer
 * public operation replaced. This one asks the same question about the other
 * half of the load's rollback -- the entries it registered itself -- and about
 * the durable work a public operation established against them: whose entry is
 * standing under the entity now, and what a detach would take away with it.
 */
import { EntityState } from '../packages/core/src';
import type { ModelBuilder } from '../packages/core/src';
import { rejection } from './support/accessor-refusal-support';
import { refusal } from './support/link-refusal-support';
import {
    expectDetachPoison,
    expectPoison,
    failPausedLoad,
    ownershipRefusal,
    pauseWithOwnedTag,
    restorationCauses,
    storedTagNames,
} from './support/navigation-load-ownership-support';
import {
    RaceTag,
    RaceContext,
    RacePost,
    storedRaceJoinRows,
} from './support/navigation-supersession-support';
import { requireDefined } from './support/require-defined';

describe('a failed load unwinding tracking it no longer owns', () => {
    it('keeps an attach() that re-established tracking mid-load', async () => {
        const run = await pauseWithOwnedTag();
        const { db, tag } = run;
        const owned = requireDefined(db.changeTracker.entry(tag));

        // The load's tracking is taken away and the caller establishes its own.
        db.changeTracker.detach(tag);
        db.tags.attach(tag);
        tag.name = 'renamed-by-user';
        expect(db.changeTracker.entry(tag)).not.toBe(owned);
        expect(db.getSavePlanDebugView()).toContain('Modified');

        await failPausedLoad(run);

        // The entry the load created is long gone; the one standing here came
        // from a public attach() and is not the load's to take back. A distinct
        // entry is proof rather than ambiguity, so nothing is poisoned either.
        expect(db.changeTracker.entry(tag)).toBeDefined();
        expect(db.getSavePlanDebugView()).toContain('Modified');
        await expect(db.saveChanges()).resolves.toBe(1);
        await expect(storedTagNames(db))
            .resolves.toEqual(['renamed-by-user', 'Postgres']);
        await db.dispose();
    });

    it('does not silently drop a link() queued against an owned entity', async () => {
        const run = await pauseWithOwnedTag();
        const { db, post, tag } = run;

        db.link(post, row => row.tags, tag);
        expect(post.tags.map(row => row.id)).toEqual(['tag_1']);
        expect(db.getSavePlanDebugView()).toContain('post_1->tag_1');

        await failPausedLoad(run);

        // Detaching the tag would cancel the queued insert, but the collection
        // the link() published is not the load's to roll back, so the graph
        // would still claim a link no save will ever write. The detach fails
        // closed instead: the tag stays tracked, the queue stays queued, and
        // the ambiguity is reported rather than resolved.
        expect(db.changeTracker.entry(tag)).toBeDefined();
        expect(post.tags.map(row => row.id)).toEqual(['tag_1']);
        expectDetachPoison(db);
        expect(await storedRaceJoinRows(db)).toEqual([]);
        await db.dispose();
    });

    it('does not silently drop an unlink() queued against an owned entity', async () => {
        const run = await pauseWithOwnedTag(true);
        const { db, post, tag } = run;
        db.link(post, row => row.tags, tag);
        db.changeTracker.acceptAllChanges();
        expect(post.tags.map(row => row.id)).toEqual(['tag_1']);

        db.unlink(post, row => row.tags, tag);
        expect(post.tags).toEqual([]);
        expect(db.getSavePlanDebugView()).toContain('post_1->tag_1');

        await failPausedLoad(run);

        // The mirror of the link case. Detaching would leave the row in the
        // join table forever while the graph says it is gone; the row is still
        // there either way, but now the context says so.
        expect(await storedRaceJoinRows(db)).toEqual(['post_1->tag_1']);
        expectDetachPoison(db);
        await db.dispose();
    });

    it('keeps source-side queued work after the application restores the visible collection', async () => {
        const db = await openOwnedPostGraph();
        const headline = requireDefined(await db.headlines.find('headline_1'));
        const tag = requireDefined(await db.tags.find('tag_1'));
        const reached = db.connection.pauseOn('race_post_tags');
        const loading = db.headlines.include(row => row.post).thenInclude(row => row.tags).toArray();
        await reached;
        const post = requireDefined(headline.post);
        db.link(post, row => row.tags, tag);
        post.tags = [];
        expect(db.getSavePlanDebugView()).toContain('post_1->tag_1');

        const primary = new Error('nested join failed');
        db.connection.failPaused(primary);
        expect(await rejection(async () => loading)).toBe(primary);

        expect(db.changeTracker.entry(post)).toBeDefined();
        expect(post.tags).toEqual([]);
        const poison = expectPoison(refusal(() => {
            db.getSavePlan();
        }));
        expect(restorationCauses(poison)).toEqual([ownershipRefusal('RacePost')]);
        expect(await storedRaceJoinRows(db)).toEqual([]);
        await db.dispose();
    });

    it('rolls back its own entity while preserving a queued link between other entities', async () => {
        const run = await pauseWithOwnedTag();
        const { db, post, tag } = run;
        const unrelated = Object.assign(new RaceTag(), { id: 'tag_2', name: 'Postgres' });
        db.tags.attach(unrelated);
        db.link(post, row => row.tags, unrelated);

        await failPausedLoad(run);

        expect(db.changeTracker.entry(tag)).toBeUndefined();
        expect(db.changeTracker.entry(unrelated)).toBeDefined();
        expect(post.tags).toEqual([unrelated]);
        await expect(db.saveChanges()).resolves.toBe(0);
        expect(await storedRaceJoinRows(db)).toEqual(['post_1->tag_2']);
        await db.dispose();
    });

    it('does not silently drop a remove() of an owned entity', async () => {
        const run = await pauseWithOwnedTag();
        const { db, tag } = run;

        db.tags.remove(tag);
        expect(requireDefined(db.changeTracker.entry(tag)).state)
            .toBe(EntityState.Deleted);

        await failPausedLoad(run);

        // A detach would erase the pending delete as quietly as it erases a
        // queued join row: the entry left the load's state, so it is no longer
        // the load's to take back.
        expect(requireDefined(db.changeTracker.entry(tag)).state)
            .toBe(EntityState.Deleted);
        expectDetachPoison(db);
        await expect(storedTagNames(db))
            .resolves.toEqual(['TypeScript', 'Postgres']);
        await db.dispose();
    });

    it('does not silently drop a detected change to an owned entity', async () => {
        const run = await pauseWithOwnedTag();
        const { db, tag } = run;

        tag.name = 'renamed-mid-load';
        db.changeTracker.detectChanges();
        expect(requireDefined(db.changeTracker.entry(tag)).state)
            .toBe(EntityState.Modified);

        await failPausedLoad(run);

        // The load registered this entry Unchanged; it is Modified now, and
        // the update it carries is exactly what a detach would throw away.
        expect(requireDefined(db.changeTracker.entry(tag)).state)
            .toBe(EntityState.Modified);
        expect(tag.name).toBe('renamed-mid-load');
        expectDetachPoison(db);
        await expect(storedTagNames(db))
            .resolves.toEqual(['TypeScript', 'Postgres']);
        await db.dispose();
    });

    it('refuses every entry point with the one refused-detach poison', async () => {
        const run = await pauseWithOwnedTag();
        const { db, post, tag } = run;
        db.link(post, row => row.tags, tag);

        await failPausedLoad(run);

        const poison = expectDetachPoison(db);
        expect(refusal(() => {
            db.getSavePlanDebugView();
        })).toBe(poison);
        expect(await rejection(async () => db.notes.find('note_1')))
            .toBe(poison);
        expect(await rejection(async () => db.saveChanges())).toBe(poison);
        expect(refusal(() => {
            db.changeTracker.clear();
        })).toBe(poison);
        expect(refusal(() => {
            db.unlink(post, row => row.tags, tag);
        })).toBe(poison);
        await db.dispose();
    });

    it('still detaches an owned entity nothing else claimed', async () => {
        const run = await pauseWithOwnedTag();
        const { db, tag } = run;

        await failPausedLoad(run);

        // The unchanged half of the contract: ownership rollback still works.
        expect(db.changeTracker.entry(tag)).toBeUndefined();
        expect(run.note.tag).toBeNull();
        await expect(db.notes.count()).resolves.toBe(1);
        await expect(db.saveChanges()).resolves.toBe(0);
        await db.dispose();
    });

    it('leaves an add() that landed mid-load alone', async () => {
        const run = await pauseWithOwnedTag();
        const { db } = run;
        const fresh: RaceTag = {
            id: 'tag_9', name: 'new', posts: [], notes: [],
        };
        db.tags.add(fresh);

        await failPausedLoad(run);

        expect(db.changeTracker.entry(fresh)).toBeDefined();
        expect(db.getSavePlanDebugView()).toContain('tag_9');
        await expect(db.saveChanges()).resolves.toBe(1);
        await db.dispose();
    });

    it('leaves a replacement instance attached under the same key alone', async () => {
        const run = await pauseWithOwnedTag();
        const { db, tag } = run;
        db.changeTracker.detach(tag);
        const replacement: RaceTag = {
            id: 'tag_1', name: 'replacement', posts: [], notes: [],
        };
        db.tags.attach(replacement);

        await failPausedLoad(run);

        expect(db.changeTracker.entry(replacement)).toBeDefined();
        expect(db.changeTracker.entry(tag)).toBeUndefined();
        await expect(db.saveChanges()).resolves.toBe(0);
        await db.dispose();
    });
});

class Headline {
    public id = '';
    public postId = '';
    public post: RacePost | null = null;
}

class OwnedPostContext extends RaceContext {
    public headlines = this.set(Headline);

    protected override model(model: ModelBuilder): void {
        super.model(model);
        model.entity(Headline, entity => {
            entity.toTable('headlines');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.postId).hasColumnName('post_id').hasColumnType('text').isRequired();
            entity.hasOne(RacePost, row => row.post).withMany().hasForeignKey(row => row.postId);
        });
    }
}

async function openOwnedPostGraph(): Promise<OwnedPostContext> {
    const db = OwnedPostContext.create();
    for (const statement of [
        { text: db.database.createScript(), values: [] },
        { text: 'insert into race_posts (id, title) values (?, ?)', values: ['post_1', 'Book'] },
        { text: 'insert into race_tags (id, name) values (?, ?)', values: ['tag_1', 'Fiction'] },
        { text: 'insert into headlines (id, post_id) values (?, ?)', values: ['headline_1', 'post_1'] },
    ]) await db.connection.query(statement);
    return db;
}
