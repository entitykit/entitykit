/**
 * Two graphs that put a failing load at the edges of the ownership fingerprint.
 *
 * `LeakContext` carries a navigation accessor that is not read-stable, which is
 * the only way to fail the checkpoint *capture* rather than the comparison.
 * `StampContext` carries a `valueGeneratedOnAddOrUpdate` column, which is the
 * one kind of mapped value change detection refuses to call a modification.
 */
import type { DbContextOptionsBuilder, ModelBuilder } from '../../packages/core/src';
import { DbContext } from '../../packages/core/src';
import { sqliteProviderServices } from '../../packages/sqlite/src';
import { rejection } from './accessor-refusal-support';
import { refusal } from './link-refusal-support';
import {
    expectPoison,
    ownershipRefusal,
    restorationCauses,
} from './navigation-load-ownership-support';
import { PausingSqliteConnection } from './nested-include-pause-support';
import { requireDefined } from './require-defined';

/**
 * Arms a navigation accessor that refuses only its *second* read.
 *
 * The window matters. Registration already reads every configured navigation
 * once, so an accessor refusing every read fails inside `track()` and unwinds
 * with no entry to own. The checkpoint reads each navigation a second time, so
 * one that is not read-stable fails after `track()` has already succeeded --
 * the only throw site between establishing tracking and recording it.
 */
const refuseSecondRead = { armed: false, reads: 0 };

/** Disarm the accessor between cases, whatever the case left behind. */
export function resetCaptureRefusal(): void {
    refuseSecondRead.armed = false;
    refuseSecondRead.reads = 0;
}

export class LeakDeep {
    public id = '';
    public tags: LeakTag[] = [];
}

export class LeakTag {
    public id = '';
    public name = '';
    public deepId = '';
    public deep: LeakDeep | null = null;
    /** Public so the include proxy type can still map this class. */
    public backing: LeakNote[] = [];

    public get notes(): LeakNote[] {
        if (refuseSecondRead.armed) {
            refuseSecondRead.reads += 1;
            if (refuseSecondRead.reads > 1) {
                throw new Error('navigation accessor refused');
            }
        }
        return this.backing;
    }

    public set notes(value: LeakNote[]) {
        this.backing = value;
    }
}

export class LeakNote {
    public id = '';
    public tagId = '';
    public tag: LeakTag | null = null;
}

export class LeakContext extends DbContext {
    public deeps = this.set(LeakDeep);
    public tags = this.set(LeakTag);
    public notes = this.set(LeakNote);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(LeakDeep, entity => {
            entity.toTable('leak_deeps');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
        });
        model.entity(LeakTag, entity => {
            entity.toTable('leak_tags');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
            entity.property(row => row.deepId).hasColumnName('deep_id')
                .hasColumnType('text').isRequired();
            entity.hasOne(LeakDeep, row => row.deep).withMany(row => row.tags)
                .hasForeignKey(row => row.deepId);
        });
        model.entity(LeakNote, entity => {
            entity.toTable('leak_notes');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.tagId).hasColumnName('tag_id')
                .hasColumnType('text').isRequired();
            entity.hasOne(LeakTag, row => row.tag).withMany(row => row.notes)
                .hasForeignKey(row => row.tagId);
        });
    }
}

/** One deep, one tag under it, and one note under the tag. */
export async function openLeakGraph(): Promise<LeakContext> {
    const db = LeakContext.create();
    for (const statement of [
        { text: db.database.createScript(), values: [] },
        { text: 'insert into leak_deeps (id) values (?)', values: ['deep_1'] },
        {
            text: 'insert into leak_tags (id, name, deep_id) values (?, ?, ?)',
            values: ['tag_1', 'original', 'deep_1'],
        },
        {
            text: 'insert into leak_notes (id, tag_id) values (?, ?)',
            values: ['note_1', 'tag_1'],
        },
    ]) await db.database.connection.query(statement);
    return db;
}

/** Run the nested include whose checkpoint capture refuses. */
export async function failedCaptureLoad(db: LeakContext): Promise<unknown> {
    refuseSecondRead.armed = true;
    refuseSecondRead.reads = 0;
    try {
        return await rejection(async () => db.notes
            .include(row => row.tag)
            .thenInclude(row => row.deep)
            .toArray());
    } finally {
        refuseSecondRead.armed = false;
    }
}

/** The same include with the accessor unarmed, so the capture succeeds. */
export async function cleanCaptureLoad(db: LeakContext): Promise<void> {
    await db.notes
        .include(row => row.tag)
        .thenInclude(row => row.deep)
        .toArray();
}

export function trackedLeakTags(db: LeakContext): readonly object[] {
    return db.changeTracker.entries()
        .filter(entry => entry.entity instanceof LeakTag)
        .map(entry => entry.entity);
}

/** The poison the refused detach of an unfingerprinted tag left behind. */
export function expectLeakPoison(db: LeakContext): unknown {
    const poison = expectPoison(refusal(() => {
        db.getSavePlan();
    }));
    expect(restorationCauses(poison)).toEqual([ownershipRefusal('LeakTag')]);
    return poison;
}

export class StampDeep {
    public id = '';
    public rows: StampRow[] = [];
}

export class StampRow {
    public id = '';
    public deepId = '';
    /** Generated by the store on every write; never sent in an UPDATE. */
    public stamp = '';
    public deep: StampDeep | null = null;
    public notes: StampNote[] = [];
}

export class StampNote {
    public id = '';
    public rowId = '';
    public row: StampRow | null = null;
}

export class StampContext extends DbContext {
    public readonly connection = new PausingSqliteConnection();
    public deeps = this.set(StampDeep);
    public rows = this.set(StampRow);
    public notes = this.set(StampNote);

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
        model.entity(StampDeep, entity => {
            entity.toTable('stamp_deeps');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
        });
        model.entity(StampRow, entity => {
            entity.toTable('stamp_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.deepId).hasColumnName('deep_id')
                .hasColumnType('text').isRequired();
            entity.property(row => row.stamp).hasColumnType('text')
                .isRequired().valueGeneratedOnAddOrUpdate();
            entity.hasOne(StampDeep, row => row.deep).withMany(row => row.rows)
                .hasForeignKey(row => row.deepId);
        });
        model.entity(StampNote, entity => {
            entity.toTable('stamp_notes');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.rowId).hasColumnName('row_id')
                .hasColumnType('text').isRequired();
            entity.hasOne(StampRow, row => row.row).withMany(row => row.notes)
                .hasForeignKey(row => row.rowId);
        });
    }
}

export interface PausedStampLoad {
    readonly db: StampContext;
    /** A row THIS load was the first to track. */
    readonly row: StampRow;
    readonly loading: Promise<unknown>;
}

/** Stitch `note.row` with a row the load materialized, then hold the level below. */
export async function pauseWithOwnedStampRow(): Promise<PausedStampLoad> {
    const db = StampContext.create();
    for (const statement of [
        { text: db.database.createScript(), values: [] },
        { text: 'insert into stamp_deeps (id) values (?)', values: ['deep_1'] },
        {
            text: 'insert into stamp_rows (id, deep_id, stamp) values (?, ?, ?)',
            values: ['row_1', 'deep_1', 'v1'],
        },
        {
            text: 'insert into stamp_notes (id, row_id) values (?, ?)',
            values: ['note_1', 'row_1'],
        },
    ]) await db.database.connection.query(statement);

    const note = requireDefined(await db.notes.find('note_1'));
    const reached = db.connection.pauseOn('stamp_deeps');
    const loading = db.notes
        .include(item => item.row)
        .thenInclude(item => item.deep)
        .toArray();
    await reached;
    return { db, row: requireDefined(note.row, 'stitched row'), loading };
}

/** Release the held statement, and prove the load's own error stays primary. */
export async function failPausedStampLoad(run: PausedStampLoad): Promise<void> {
    const boom = new Error('nested deep query refused');
    run.db.connection.failPaused(boom);
    expect(await rejection(async () => run.loading)).toBe(boom);
}
