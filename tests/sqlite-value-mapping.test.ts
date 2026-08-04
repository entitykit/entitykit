import { requireDefined } from './support/require-defined';
import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, EntityState } from '../src';
import { sqliteProviderServices, sqliteValueReader } from '../src/providers/sqlite';

describe('sqliteValueReader', () => {
    it('restores booleans from SQLite storage values', () => {
        expect(sqliteValueReader.readValue(1, 'boolean')).toBe(true);
        expect(sqliteValueReader.readValue(0, 'boolean')).toBe(false);
        expect(sqliteValueReader.readValue(1n, 'bool')).toBe(true);
        expect(sqliteValueReader.readValue(0n, 'bool')).toBe(false);
        expect(sqliteValueReader.readValue(true, 'boolean')).toBe(true);
        // Text columns can hold either spelling; SQLite has no boolean literal.
        expect(sqliteValueReader.readValue('1', 'boolean')).toBe(true);
        expect(sqliteValueReader.readValue('true', 'boolean')).toBe(true);
        expect(sqliteValueReader.readValue('TRUE', 'boolean')).toBe(true);
        expect(sqliteValueReader.readValue('0', 'boolean')).toBe(false);
        expect(sqliteValueReader.readValue('false', 'boolean')).toBe(false);
    });

    it('restores dates from text and epoch storage values', () => {
        const iso = '2026-03-04T05:06:07.000Z';
        for (const columnType of ['timestamptz', 'timestamp', 'timestamp with time zone', 'datetime']) {
            const value = sqliteValueReader.readValue(iso, columnType);
            expect(value).toBeInstanceOf(Date);
            expect((value as Date).toISOString()).toBe(iso);
        }

        const epoch = sqliteValueReader.readValue(1772600767000, 'timestamptz');
        expect(epoch).toBeInstanceOf(Date);
        expect((epoch as Date).getTime()).toBe(1772600767000);
    });

    it('leaves calendar days, clock values, and unparseable text alone', () => {
    // Only instants convert. A `date` is a calendar day and `time`/`timetz` are
    // clock values; converting them would force a timezone choice this layer
    // cannot make correctly.
        expect(sqliteValueReader.readValue('2026-03-04', 'date')).toBe('2026-03-04');
        expect(sqliteValueReader.readValue('05:06:07', 'time')).toBe('05:06:07');
        expect(sqliteValueReader.readValue('05:06:07+00', 'timetz')).toBe('05:06:07+00');
        // Never materialize an Invalid Date.
        expect(sqliteValueReader.readValue('not a date', 'timestamptz')).toBe('not a date');
    });

    it('parses array columns back into arrays, matching Postgres', () => {
    // SQLite has no array storage class, so EntityKit writes JSON text.
        expect(sqliteValueReader.readValue('["a","b"]', 'text[]')).toEqual(['a', 'b']);
        expect(sqliteValueReader.readValue('[1,2]', 'integer[]')).toEqual([1, 2]);
        expect(sqliteValueReader.readValue('not json', 'text[]')).toBe('not json');
    });

    it('parses json columns and keeps non-JSON text', () => {
        expect(sqliteValueReader.readValue('{"a":1}', 'json')).toEqual({ a: 1 });
        expect(sqliteValueReader.readValue('[1,2]', 'jsonb')).toEqual([1, 2]);
        expect(sqliteValueReader.readValue('not json', 'jsonb')).toBe('not json');
    });

    it('passes unmapped column types through unchanged', () => {
        expect(sqliteValueReader.readValue('hello', 'text')).toBe('hello');
        expect(sqliteValueReader.readValue(42, 'integer')).toBe(42);
        expect(sqliteValueReader.readValue('7.5', 'numeric')).toBe('7.5');
        expect(sqliteValueReader.readValue('a-b-c', 'uuid')).toBe('a-b-c');
    });

    it('normalizes column type casing and padding', () => {
        expect(sqliteValueReader.readValue(1, '  BOOLEAN  ')).toBe(true);
        expect(sqliteValueReader.readValue('{"a":1}', 'JSONB')).toEqual({ a: 1 });
    });
});

class Reading {
    public id!: string;
    public isActive!: boolean;
    public recordedAt!: Date;
    public payload!: { unit: string; samples: number[] };
    public score!: number;
    public notes!: string | null;

    constructor(data?: Partial<Reading>) {
        Object.assign(this, data);
    }
}

class ReadingContext extends DbContext {
    public readings = this.set(Reading);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Reading, entity => {
            entity.toTable('readings');
            entity.hasKey(reading => reading.id);
            entity.property(reading => reading.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(reading => reading.isActive).hasColumnName('is_active').hasColumnType('boolean').isRequired();
            entity.property(reading => reading.recordedAt).hasColumnName('recorded_at').hasColumnType('timestamptz').isRequired();
            entity.property(reading => reading.payload).hasColumnName('payload').hasColumnType('jsonb').isRequired();
            entity.property(reading => reading.score).hasColumnName('score').hasColumnType('integer').isRequired();
            entity.property(reading => reading.notes).hasColumnName('notes').hasColumnType('text');
        });
    }
}

const recordedAt = new Date('2026-03-04T05:06:07.000Z');
const laterAt = new Date('2026-05-06T07:08:09.000Z');

async function createReadingDb(): Promise<ReadingContext> {
    const db = ReadingContext.create();
    await db.database.connection.query({ text: db.database.createScript(), values: [] });
    return db;
}

async function seed(db: ReadingContext): Promise<void> {
    db.readings.add(new Reading({
        id: 'r1',
        isActive: true,
        recordedAt,
        payload: { unit: 'celsius', samples: [1, 2, 3] },
        score: 42,
        notes: null,
    }));
    db.readings.add(new Reading({
        id: 'r2',
        isActive: false,
        recordedAt: laterAt,
        payload: { unit: 'kelvin', samples: [] },
        score: 7,
        notes: 'second',
    }));
    await db.saveChanges();
    // Drop identity-map hits so reads come back through materialization.
    db.changeTracker.clear();
}

describe('SQLite multi-statement scripts', () => {
    // `DatabaseSync.prepare()` compiles only the first statement of a
    // multi-statement string and discards the rest without error, so a schema
    // script would silently create only its first table.
    it('runs every statement in a script', async () => {
        const db = ReadingContext.create();

        await db.database.connection.query({
            text: 'create table "first" ("id" text);\ncreate table "second" ("id" text);',
            values: [],
        });

        for (const table of ['first', 'second']) {
            const rows = await db.database.connection.query({ text: `select count(*) as "count" from "${table}"`, values: [] });
            expect(rows.rows).toHaveLength(1);
        }

        await db.dispose();
    });

    it('does not treat a semicolon inside a literal as a statement separator', async () => {
        const db = ReadingContext.create();
        await db.database.connection.query({ text: 'create table "notes" ("body" text)', values: [] });

        await db.database.connection.query({ text: 'insert into "notes" ("body") values (\'a;b\')', values: [] });

        const rows = await db.database.connection.query<{ body: string; count: number }>({
            text: 'select "body" from "notes"',
            values: [],
        });
        expect(rows.rows[0].body).toBe('a;b');
        // Routed through prepare(), so the affected-row count is still reported.
        const deleted = await db.database.connection.query({ text: 'delete from "notes"', values: [] });
        expect(deleted.rowCount).toBe(1);

        await db.dispose();
    });

    it('refuses a multi-statement script with bound parameters', async () => {
        const db = ReadingContext.create();

        await expect(db.database.connection.query({
            text: 'create table "a" ("id" text); insert into "a" values (?)',
            values: ['x'],
        })).rejects.toThrow('multi-statement script with bound parameters');

        await db.dispose();
    });
});

describe('SQLite value round-trip', () => {
    let db: ReadingContext;

    beforeEach(async () => {
        db = await createReadingDb();
        await seed(db);
    });

    afterEach(async () => {
        await db.dispose();
    });

    it('materializes entities with the JavaScript types the model declares', async () => {
        const reading = await db.readings.find('r1');

        expect(reading).not.toBeNull();
        // Strict equality: `1 === true` is false, which is the bug this guards.
        expect(requireDefined(reading).isActive).toBe(true);
        expect(requireDefined(reading).recordedAt).toBeInstanceOf(Date);
        expect(requireDefined(reading).recordedAt.getTime()).toBe(recordedAt.getTime());
        expect(requireDefined(reading).payload).toEqual({ unit: 'celsius', samples: [1, 2, 3] });
        expect(requireDefined(reading).score).toBe(42);
        expect(requireDefined(reading).notes).toBeNull();
    });

    it('does not report converted values as pending changes', async () => {
        const reading = await db.readings.find('r1');
        expect(reading).not.toBeNull();

        // Original values are snapshotted post-conversion, so an untouched entity
        // must not look modified.
        expect(db.changeTracker.entries().filter(entry => entry.state === EntityState.Modified)).toHaveLength(0);
        await expect(db.saveChanges()).resolves.toBe(0);
    });

    it('round-trips through save without drifting', async () => {
        const reading = await db.readings.find('r1');
        requireDefined(reading).score = 43;
        await db.saveChanges();
        db.changeTracker.clear();

        const reloaded = await db.readings.find('r1');
        expect(requireDefined(reloaded).isActive).toBe(true);
        expect(requireDefined(reloaded).recordedAt.getTime()).toBe(recordedAt.getTime());
        expect(requireDefined(reloaded).payload).toEqual({ unit: 'celsius', samples: [1, 2, 3] });
        expect(requireDefined(reloaded).score).toBe(43);
    });

    it('converts projected values', async () => {
        const rows = await db.readings
            .orderBy(reading => reading.id)
            .select(reading => ({
                id: reading.id,
                active: reading.isActive,
                at: reading.recordedAt,
                body: reading.payload,
            }))
            .toArray();

        expect(rows[0].active).toBe(true);
        expect(rows[1].active).toBe(false);
        expect(rows[0].at).toBeInstanceOf(Date);
        expect(rows[0].at.getTime()).toBe(recordedAt.getTime());
        expect(rows[0].body).toEqual({ unit: 'celsius', samples: [1, 2, 3] });
    });

    it('converts aggregate min/max values', async () => {
        const summary = await db.readings
            .aggregate(agg => ({
                readingCount: agg.count(),
                earliest: agg.min(reading => reading.recordedAt),
                latest: agg.max(reading => reading.recordedAt),
                totalScore: agg.sum(reading => reading.score),
            }))
            .single();

        expect(summary.readingCount).toBe(2);
        expect(summary.earliest).toBeInstanceOf(Date);
        expect(requireDefined(summary.earliest).getTime()).toBe(recordedAt.getTime());
        expect(summary.latest).toBeInstanceOf(Date);
        expect(requireDefined(summary.latest).getTime()).toBe(laterAt.getTime());
        expect(summary.totalScore).toBe(49);
    });

    it('converts values read through raw SQL', async () => {
        const rows = await db.readings.fromSqlUnsafe`select * from "readings" where "id" = ${'r1'}`.toArray();

        expect(rows).toHaveLength(1);
        expect(rows[0].isActive).toBe(true);
        expect(rows[0].recordedAt).toBeInstanceOf(Date);
        expect(rows[0].payload).toEqual({ unit: 'celsius', samples: [1, 2, 3] });
    });

    it('filters on boolean columns using the stored representation', async () => {
        const active = await db.readings.where(reading => reading.isActive.eq(true)).toArray();

        expect(active).toHaveLength(1);
        expect(active[0].id).toBe('r1');
        expect(active[0].isActive).toBe(true);
    });
});
