import type { DbContextOptionsBuilder, ModelBuilder } from '../../src';
import { DbContext } from '../../src';
import { sqliteProviderServices } from '../../src/providers/sqlite';
import { rejection } from './accessor-refusal-support';
import { StrongId, strongIdConverter } from './converter-fact-support';
import { PausingSqliteConnection } from './nested-include-pause-support';
import { requireDefined } from './require-defined';

export class MarkOwner {
    public id = '';
    public tags: MarkTag[] = [];
}

export class MarkTag {
    public id = '';
    /** A converter-backed value object whose state no structural walk sees. */
    public code = new StrongId('');
    public ownerId = '';
    public owner: MarkOwner | null = null;
    public notes: MarkNote[] = [];
}

export class MarkNote {
    public id = '';
    public tagId = '';
    public tag: MarkTag | null = null;
}

/**
 * A reference chain whose middle level carries a private-field mapped value.
 *
 * `note -> tag -> owner` gives the load a tag it materializes itself while the
 * owner query below can be held open indefinitely. The tag's `code` converts to
 * a plain string for the store but keeps its model state in a `#value`, so a
 * fingerprint that compared structurally rather than through the converter
 * would see two indistinguishable empty objects.
 */
export class MarkContext extends DbContext {
    public readonly connection = new PausingSqliteConnection();
    public owners = this.set(MarkOwner);
    public tags = this.set(MarkTag);
    public notes = this.set(MarkNote);

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
        model.entity(MarkOwner, entity => {
            entity.toTable('mark_owners');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
        });
        model.entity(MarkTag, entity => {
            entity.toTable('mark_tags');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.code).hasColumnType('text')
                .hasConversion(strongIdConverter).isRequired();
            entity.property(row => row.ownerId).hasColumnName('owner_id')
                .hasColumnType('text').isRequired();
            entity.hasOne(MarkOwner, row => row.owner)
                .withMany(row => row.tags)
                .hasForeignKey(row => row.ownerId);
        });
        model.entity(MarkNote, entity => {
            entity.toTable('mark_notes');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.tagId).hasColumnName('tag_id')
                .hasColumnType('text').isRequired();
            entity.hasOne(MarkTag, row => row.tag)
                .withMany(row => row.notes)
                .hasForeignKey(row => row.tagId);
        });
    }
}

/** A nested reference load held open after it materialized and stitched a tag. */
export interface PausedOwnedMarkTag {
    readonly db: MarkContext;
    readonly note: MarkNote;
    /** A tag THIS load was the first to track. */
    readonly tag: MarkTag;
    readonly loading: Promise<unknown>;
}

/** Create the schema with one owner, one tag, and one note under the tag. */
export async function openMarkGraph(): Promise<MarkContext> {
    const db = MarkContext.create();
    for (const statement of [
        { text: db.database.createScript(), values: [] },
        { text: 'insert into mark_owners (id) values (?)', values: ['owner_1'] },
        {
            text: 'insert into mark_tags (id, code, owner_id) values (?, ?, ?)',
            values: ['tag_1', 'ts', 'owner_1'],
        },
        {
            text: 'insert into mark_notes (id, tag_id) values (?, ?)',
            values: ['note_1', 'tag_1'],
        },
    ]) await db.database.connection.query(statement);
    return db;
}

/** Stitch `note.tag` with a freshly tracked tag, then hold the owner query. */
export async function pauseWithOwnedMarkTag():
Promise<PausedOwnedMarkTag> {
    const db = await openMarkGraph();
    const note = requireDefined(await db.notes.find('note_1'));
    const reached = db.connection.pauseOn('mark_owners');
    const loading = db.notes
        .include(row => row.tag)
        .thenInclude(row => row.owner)
        .toArray();
    await reached;
    const tag = requireDefined(note.tag, 'stitched tag');
    return { db, note, tag, loading };
}

/** Release the held owner query, and prove the load's error stays primary. */
export async function failPausedMarkLoad(
    run: PausedOwnedMarkTag,
): Promise<void> {
    const boom = new Error('nested owner query refused');
    run.db.connection.failPaused(boom);
    expect(await rejection(async () => run.loading)).toBe(boom);
}

/** Read the tag codes straight off the connection a poisoned context refuses. */
export async function storedMarkCodes(db: MarkContext): Promise<string[]> {
    const result = await db.connection.query<{ code: string }>({
        text: 'select code from mark_tags order by id',
        values: [],
    });
    return result.rows.map(row => row.code);
}
