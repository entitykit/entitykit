import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, EntityState } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';

class JsonRecord {
    public id!: string;
    public data!: unknown;
}

class JsonSqliteContext extends DbContext {
    public records = this.set(JsonRecord);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(JsonRecord, entity => {
            entity.toTable('json_records');
            entity.hasKey(record => record.id);
            entity.property(record => record.id)
                .hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(record => record.data)
                .hasColumnName('data').hasColumnType('jsonb').isRequired();
        });
    }
}

async function countRows(db: JsonSqliteContext): Promise<number> {
    const result = await db.database.connection.query<{ count: number }>({
        text: 'select count(*) as "count" from "json_records"',
        values: [],
    });
    return result.rows[0]?.count ?? 0;
}

describe('mapped JSON contract against SQLite', () => {
    let db: JsonSqliteContext;

    beforeEach(async () => {
        db = JsonSqliteContext.create();
        await db.database.ensureCreated();
    });

    afterEach(async () => {
        await db.dispose();
    });

    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    it.each([
        ['resolving Promise', Promise.resolve({ ok: true })],
        ['custom thenable', { then: (): void => undefined }],
        ['nested Promise', { nested: Promise.resolve(true) }],
        ['Map', new Map([['key', 'value']])],
        ['Set', new Set([1])],
        ['non-finite number', { score: Number.POSITIVE_INFINITY }],
        ['nested undefined', { nested: undefined }],
        ['nested function', { nested: (): void => undefined }],
        ['nested symbol', { nested: Symbol('value') }],
        ['cycle', cyclic],
    ])('rejects a %s without storing a row', async (_label, value) => {
        const record = Object.assign(new JsonRecord(), {
            id: 'record_1',
            data: value,
        });
        db.records.add(record);

        await expect(db.saveChanges()).rejects.toThrow(
            'Unsupported JSON value at \'JsonRecord.data',
        );
        expect(await countRows(db)).toBe(0);
        expect(db.entry(record)?.state).toBe(EntityState.Added);
    });

    it('consumes a rejected Promise and retries the same tracked entity', async () => {
        const unhandled: unknown[] = [];
        const observeUnhandled = (reason: unknown): void => {
            unhandled.push(reason);
        };
        process.on('unhandledRejection', observeUnhandled);
        try {
            const record: JsonRecord = Object.assign(new JsonRecord(), {
                id: 'record_1',
                data: Promise.reject(new Error('JSON failed')),
            });
            db.records.add(record);

            await expect(db.saveChanges()).rejects.toThrow('Promise or thenable');
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(unhandled).toEqual([]);
            expect(await countRows(db)).toBe(0);
            expect(db.entry(record)?.state).toBe(EntityState.Added);

            record.data = { ok: true, values: [1, 2] };
            await expect(db.saveChanges()).resolves.toBe(1);
            expect(await countRows(db)).toBe(1);
            expect(db.entry(record)?.state).toBe(EntityState.Unchanged);
        } finally {
            process.off('unhandledRejection', observeUnhandled);
        }
    });

    it('compares recursively reordered objects as the same JSON value', async () => {
        const record = Object.assign(new JsonRecord(), {
            id: 'record_1',
            data: {
                status: 'active',
                filters: [{ tenant: 'acme', region: 'us' }],
            },
        });
        db.records.add(record);
        await db.saveChanges();
        db.changeTracker.clear();

        const first = await db.records.where(item => item.data.eq({
            status: 'active',
            filters: [{ tenant: 'acme', region: 'us' }],
        })).single();
        const cacheHit = await db.records.where(item => item.data.eq({
            filters: [{ region: 'us', tenant: 'acme' }],
            status: 'active',
        })).single();

        expect(first.id).toBe('record_1');
        expect(cacheHit.id).toBe('record_1');
    });
});
