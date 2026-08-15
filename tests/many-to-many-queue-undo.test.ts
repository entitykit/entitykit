import { ModelBuilder } from '../src/model/model-builder';
import { ManyToManyChangeSet } from '../src/core/many-to-many-change-set';
import { buildNavigationLinkChange } from '../src/core/navigation-link-change';
import type { EntityEntry } from '../src/tracking/entity-entry';
import type { ManyToManyChange } from '../src/core/many-to-many-change';

class QueueTag {
    public id = '';
    public posts: QueuePost[] = [];
}

class QueuePost {
    public id = '';
    public tags: QueueTag[] = [];
}

const model = new ModelBuilder()
    .entity(QueuePost, entity => {
        entity.toTable('queue_posts');
        entity.hasKey(row => row.id);
        entity.property(row => row.id).hasColumnType('text').isRequired();
        entity.hasManyToMany(QueueTag, row => row.tags)
            .withMany(row => row.posts)
            .usingJoinTable('queue_post_tags', join => {
                join.sourceForeignKey('post_id');
                join.targetForeignKey('tag_id');
            });
    })
    .entity(QueueTag, entity => {
        entity.toTable('queue_tags');
        entity.hasKey(row => row.id);
        entity.property(row => row.id).hasColumnType('text').isRequired();
    })
    .build();

function tag(id: string): QueueTag {
    return Object.assign(new QueueTag(), { id });
}

function post(id: string): QueuePost {
    return Object.assign(new QueuePost(), { id });
}

function changeSet(): ManyToManyChangeSet {
    return new ManyToManyChangeSet(() => ({}) as EntityEntry<object>);
}

function linkChange(
    source: QueuePost,
    target: QueueTag,
    action: 'link' | 'unlink' = 'link',
): ManyToManyChange {
    return buildNavigationLinkChange(model, action, source, 'tags', target)
        .change;
}

describe('many-to-many queue undo', () => {
    it('removes only the change the undo was handed back for', () => {
        const changes = changeSet();
        const source = post('p1');
        const first = linkChange(source, tag('t1'));
        const second = linkChange(source, tag('t2'));
        const third = linkChange(source, tag('t3'));

        changes.queue(first);
        const cancelSecond = changes.queue(second);
        changes.queue(third);
        cancelSecond();

        expect(changes.size).toBe(2);
        expect(remaining(changes)).toEqual([first, third]);
    });

    it('removes its own change when an equal relationship is queued twice', () => {
        const changes = changeSet();
        const source = post('p1');
        const target = tag('t1');
        const earlier = linkChange(source, target);
        const later = linkChange(source, target);

        changes.queue(earlier);
        const cancelLater = changes.queue(later);
        cancelLater();

        expect(remaining(changes)).toEqual([earlier]);
    });

    it('is idempotent when the undo is called more than once', () => {
        const changes = changeSet();
        const source = post('p1');
        const first = linkChange(source, tag('t1'));
        const cancelFirst = changes.queue(first);
        const second = linkChange(source, tag('t2'));
        changes.queue(second);

        cancelFirst();
        cancelFirst();
        cancelFirst();

        expect(remaining(changes)).toEqual([second]);
    });

    it('does nothing when its change was already accepted', () => {
        const changes = changeSet();
        const source = post('p1');
        const only = linkChange(source, tag('t1'));
        const cancelOnly = changes.queue(only);

        changes.accept([only]);
        cancelOnly();

        expect(changes.size).toBe(0);
    });

    it('ignores a stale undo after the same change is queued again', () => {
        const changes = changeSet();
        const source = post('p1');
        const change = linkChange(source, tag('t1'));
        const cancelFirst = changes.queue(change);

        cancelFirst();
        changes.queue(change);
        cancelFirst();

        expect(changes.size).toBe(1);
        expect(remaining(changes)).toEqual([change]);
    });

    it('keeps the queue whole when a stale undo runs after acceptance', () => {
        const changes = changeSet();
        const source = post('p1');
        const accepted = linkChange(source, tag('t1'));
        const kept = linkChange(source, tag('t2'));
        const cancelAccepted = changes.queue(accepted);
        changes.queue(kept);

        changes.accept([accepted]);
        cancelAccepted();

        expect(remaining(changes)).toEqual([kept]);
    });

    it('cancels an unlink the same way it cancels a link', () => {
        const changes = changeSet();
        const source = post('p1');
        const kept = linkChange(source, tag('t1'));
        changes.queue(kept);
        const cancelRemoval = changes.queue(
            linkChange(source, tag('t2'), 'unlink'),
        );

        cancelRemoval();

        expect(remaining(changes)).toEqual([kept]);
    });
});

/** The queue is private, so identity assertions read it through a cast. */
function remaining(changes: ManyToManyChangeSet): readonly ManyToManyChange[] {
    return (changes as unknown as {
        readonly changes: readonly ManyToManyChange[];
    }).changes;
}
