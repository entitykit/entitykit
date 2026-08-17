/**
 * One tracked entry standing exactly as a navigation load registered it.
 *
 * The ownership fingerprint compares facts that live in four different places:
 * the entry's own values and bound values, the complex containers on the live
 * entity, the navigation baselines and loaded flags the tracker holds beside
 * the entry, and the change-detection suppression beside those. A load moves
 * several of them at once, so a full include can never isolate one leg. Here
 * the registration is assembled from the same primitives a load uses and then
 * exactly one fact is moved per case, which is the only way to say which leg
 * of the comparison refused.
 */
import { EntityState, valueConverter } from '../../src';
import type { EntityMetadata } from '../../src/model/entity-metadata';
import { ModelBuilder } from '../../src/model/model-builder';
import { ChangeTracker } from '../../src/tracking/change-tracker';
import type { EntityEntry } from '../../src/tracking/entity-entry';
import {
    suppressNavigationChangeDetection,
} from '../../src/tracking/navigation-change-detection-state';
import {
    captureOwnedEntryCheckpoint,
    type OwnedEntryCheckpoint,
} from '../../src/tracking/navigation-load-ownership-checkpoint';

/** The model value a converter refuses to convert synchronously. */
export const deferredCode = 'deferred';

/** Every model value the code converter was asked to convert, in order. */
export const codeConversions: string[] = [];

/**
 * A converter that records every provider conversion asked of it.
 *
 * The recording is the point: the comparison promises to read a baseline the
 * entry still holds by identity rather than through a converter, and only the
 * conversions it actually ran can say so. One sentinel value hands back a
 * promise instead, which is the one way a comparison can fail loudly enough to
 * name the property it was reading.
 */
export const markCodeConverter = valueConverter<string, string>({
    toProvider: value => {
        codeConversions.push(value);
        return value === deferredCode
            ? (Promise.resolve(value) as unknown as string)
            : value;
    },
    fromProvider: value => value,
});

export class MarkSlot {
    public zone = '';
}

export class MarkDeep {
    public id = '';
    public tags: MarkTag[] = [];
    public owned: MarkTag[] = [];
}

export class MarkNote {
    public id = '';
    public tagId = '';
    public tag: MarkTag | null = null;
}

export class MarkTag {
    public id = '';
    public code = '';
    public deepId = '';
    public ownerId = '';
    public slot = new MarkSlot();
    public deep: MarkDeep | null = null;
    public owner: MarkDeep | null = null;
    public notes: MarkNote[] = [];
}

let cachedMetadata: EntityMetadata<MarkTag> | undefined;

/** Two reference navigations, one collection, one complex container. */
function markTagMetadata(): EntityMetadata<MarkTag> {
    cachedMetadata ??= buildModel();
    return cachedMetadata;
}

function buildModel(): EntityMetadata<MarkTag> {
    const model = new ModelBuilder();
    model.entity(MarkDeep, entity => {
        entity.toTable('mark_deeps');
        entity.hasKey(row => row.id);
        entity.property(row => row.id).hasColumnType('text').isRequired();
    });
    model.entity(MarkNote, entity => {
        entity.toTable('mark_notes');
        entity.hasKey(row => row.id);
        entity.property(row => row.id).hasColumnType('text').isRequired();
        entity.property(row => row.tagId).hasColumnName('tag_id')
            .hasColumnType('text').isRequired();
        entity.hasOne(MarkTag, row => row.tag).withMany(row => row.notes)
            .hasForeignKey(row => row.tagId);
    });
    model.entity(MarkTag, entity => {
        entity.toTable('mark_tags');
        entity.hasKey(row => row.id);
        entity.property(row => row.id).hasColumnType('text').isRequired();
        entity.property(row => row.code).hasColumnType('text').isRequired()
            .hasConversion(markCodeConverter);
        entity.property(row => row.deepId).hasColumnName('deep_id')
            .hasColumnType('text').isRequired();
        entity.property(row => row.ownerId).hasColumnName('owner_id')
            .hasColumnType('text').isRequired();
        entity.complexProperty(
            row => row.slot,
            { constructor: MarkSlot, required: true },
            slot => {
                slot.property(value => value.zone).hasColumnName('slot_zone')
                    .hasColumnType('text').isRequired();
            },
        );
        entity.hasOne(MarkDeep, row => row.deep).withMany(row => row.tags)
            .hasForeignKey(row => row.deepId);
        entity.hasOne(MarkDeep, row => row.owner).withMany(row => row.owned)
            .hasForeignKey(row => row.ownerId);
    });
    return model.build().getEntity(MarkTag);
}

export interface RegisteredTag {
    readonly tracker: ChangeTracker;
    readonly entry: EntityEntry<object>;
    readonly tag: MarkTag;
    /** The graph both reference navigations stand in. */
    readonly deep: MarkDeep;
    /** A graph nothing on this entry points at. */
    readonly other: MarkDeep;
    readonly checkpoint: OwnedEntryCheckpoint;
}

/**
 * Track a tag and leave it as a load's registration would: two navigations
 * flagged loaded with baselines behind them, and a third left suppressed.
 */
export function registerOwnedTag(): RegisteredTag {
    const deep = graph('deep_1');
    const other = graph('deep_2');
    const tag = new MarkTag();
    Object.assign(tag, {
        id: 'tag_1', code: 'ts', deepId: 'deep_1', ownerId: 'deep_1',
        deep, owner: deep,
    });
    tag.slot.zone = 'north';
    tag.notes = [note(tag)];
    const tracker = new ChangeTracker();
    const entry: EntityEntry<object> = tracker.track(
        tag, markTagMetadata(), EntityState.Unchanged,
    ) as unknown as EntityEntry<object>;
    entry.markNavigationLoaded('deep');
    entry.markNavigationLoaded('owner');
    suppressNavigationChangeDetection(entry, 'notes');
    return {
        tracker, entry, tag, deep, other,
        checkpoint: captureOwnedEntryCheckpoint(tracker, entry),
    };
}

function graph(id: string): MarkDeep {
    const deep = new MarkDeep();
    deep.id = id;
    return deep;
}

function note(tag: MarkTag): MarkNote {
    const row = new MarkNote();
    Object.assign(row, { id: 'note_1', tagId: tag.id, tag });
    return row;
}
