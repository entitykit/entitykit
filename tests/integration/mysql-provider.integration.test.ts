import { requireDefined } from '../support/require-defined';
import type { DbContextOptionsBuilder, ModelBuilder } from '../../packages/core/src';
import { DbContext, UniqueConstraintError } from '../../packages/core/src';
import type { MigrationBuilder } from '../../packages/core/src/migrations/api';
import { Migration, MigrationRunner } from '../../packages/core/src/migrations/api';
import { mySqlProviderServices } from '../../packages/mysql/src';

const url = process.env.MYSQL_URL ?? process.env.MYSQL_DATABASE_URL;
const shouldRun = process.env.RUN_MYSQL_TESTS === 'true' && Boolean(url);
const maybe = shouldRun ? describe : describe.skip;

/**
 * The MySQL provider against a live server. It mirrors the behaviours the
 * shared provider contract checks — the parity-sensitive ones a new provider
 * most easily gets wrong — plus a migration round-trip.
 */
class Value {
    public id!: string;
    public isActive!: boolean;
    public recordedAt!: Date;
    public payload!: { unit: string; samples: number[] };
    public score!: number;
    public label!: string | null;

    constructor(data?: Partial<Value>) {
        Object.assign(this, data);
    }
}

class MySqlDbContext extends DbContext {
    public values = this.set(Value);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(mySqlProviderServices, requireDefined(url));
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Value, entity => {
            entity.toTable('mysql_values');
            entity.hasKey(value => value.id);
            entity.property(value => value.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(value => value.isActive).hasColumnName('is_active').hasColumnType('boolean').isRequired();
            entity.property(value => value.recordedAt).hasColumnName('recorded_at').hasColumnType('timestamptz').isRequired();
            entity.property(value => value.payload).hasColumnName('payload').hasColumnType('jsonb').isRequired();
            entity.property(value => value.score).hasColumnName('score').hasColumnType('integer').isRequired();
            entity.property(value => value.label).hasColumnName('label').hasColumnType('text');
        });
    }
}

const at = new Date('2026-03-04T05:06:07.000Z');
const payload = { unit: 'celsius', samples: [1, 2, 3] };
const value = (id: string, overrides: Partial<Value> = {}): Value =>
    new Value({ id, isActive: true, recordedAt: at, payload, score: 1, label: null, ...overrides });

class CreateThings extends Migration {
    public readonly id = '20260101000001_CreateThings';
    public readonly name = 'CreateThings';
    public override up(builder: MigrationBuilder): void {
        builder.createTable('mysql_things', [
            { name: 'id', type: 'text', primaryKey: true },
            { name: 'label', type: 'text', nullable: true },
        ]);
    }
    public override down(builder: MigrationBuilder): void {
        builder.dropTable('mysql_things');
    }
}

maybe('MySQL provider', () => {
    let db: MySqlDbContext;

    beforeEach(async () => {
        db =  MySqlDbContext.create();
        await db.database.connection.query({ text: 'drop table if exists mysql_values', values: [] });
        await db.database.connection.query({ text: db.database.createScript(), values: [] });
    });

    afterEach(async () => {
        await db.database.connection.query({ text: 'drop table if exists mysql_values', values: [] });
        await db.database.connection.query({ text: 'drop table if exists mysql_things', values: [] });
        await db.database.connection.query({ text: 'drop table if exists __entitykit_migrations', values: [] });
        await db.dispose();
    });

    it('round-trips mapped column types to the declared JavaScript values', async () => {
        db.values.add(value('v1', { isActive: true, score: 42, label: 'hello' }));
        await db.saveChanges();
        db.changeTracker.clear();

        const found = await db.values.find('v1');
        expect(found).toBeDefined();
        expect(requireDefined(found).isActive).toBe(true);
        expect(requireDefined(found).recordedAt).toBeInstanceOf(Date);
        expect(requireDefined(found).recordedAt.getTime()).toBe(at.getTime());
        expect(requireDefined(found).payload).toEqual(payload);
        expect(requireDefined(found).score).toBe(42);
        expect(requireDefined(found).label).toBe('hello');
    });

    it('orders nulls SQL-standard despite MySQL having no NULLS clause', async () => {
        db.values.add(value('a', { label: 'alpha' }));
        db.values.add(value('b', { label: null }));
        db.values.add(value('c', { label: 'beta' }));
        await db.saveChanges();
        db.changeTracker.clear();

        const asc = (await db.values.orderBy(v => v.label).toArray()).map(v => v.id);
        expect(asc.at(-1)).toBe('b');
        const desc = (await db.values.orderByDescending(v => v.label).toArray()).map(v => v.id);
        expect(desc[0]).toBe('b');
    });

    it('matches text case-sensitively despite MySQL\'s default collation', async () => {
        db.values.add(value('upper', { label: 'Alpha' }));
        db.values.add(value('lower', { label: 'alpha' }));
        await db.saveChanges();
        db.changeTracker.clear();

        const matched = (await db.values.where(v => v.label.like('a%')).toArray()).map(v => v.id);
        expect(matched).toEqual(['lower']);
    });

    it('upserts, inserting what is missing and overwriting what is not', async () => {
        await db.values.upsert([value('u1', { score: 1 }), value('u2', { score: 2 })]);
        db.changeTracker.clear();
        const affected = await db.values.upsert([
            value('u1', { score: 10, label: 'updated' }),
            value('u3', { score: 3 }),
        ]);
        db.changeTracker.clear();

        expect(affected).toBe(2);
        expect((await db.values.orderBy(v => v.id).toArray()).map(v => v.id)).toEqual(['u1', 'u2', 'u3']);
        expect(await db.values.find('u1')).toMatchObject({ score: 10, label: 'updated' });
    });

    it('classifies a duplicate key as UniqueConstraintError', async () => {
        db.values.add(value('dup'));
        await db.saveChanges();
        db.changeTracker.clear();

        db.values.add(value('dup'));
        await expect(db.saveChanges()).rejects.toBeInstanceOf(UniqueConstraintError);
    });

    it('keeps the outer transaction when an inner one rolls back to a savepoint', async () => {
        db.values.add(value('outer'));
        await db.saveChanges();
        db.changeTracker.clear();

        await db.transaction(async () => {
            await expect(db.transaction(async () => {
                await db.database.connection.query({
                    text: 'insert into mysql_values (id, is_active, recorded_at, payload, score, label) values (?, ?, ?, ?, 1, null)',
                    values: ['inner', true, at, payload],
                });
                throw new Error('roll the inner one back');
            })).rejects.toThrow('roll the inner one back');
        });

        expect((await db.values.toArray()).map(v => v.id).sort()).toEqual(['outer']);
    });

    it('applies and rolls back a migration with history agreeing with the schema', async () => {
        const runner = new MigrationRunner(
            db.database.connection,
            mySqlProviderServices.migrationDialect,
            mySqlProviderServices.createMigrationBuilder,
        );
        await db.database.connection.query({ text: 'drop table if exists mysql_things', values: [] });
        await db.database.connection.query({ text: 'drop table if exists __entitykit_migrations', values: [] });

        await runner.update([new CreateThings()]);
        const applied = await db.database.connection.query<{ id: string }>({ text: 'select id from __entitykit_migrations', values: [] });
        expect(applied.rows.map(row => row.id)).toEqual(['20260101000001_CreateThings']);

        await runner.update([new CreateThings()], { target: '0' });
        const afterRollback = await db.database.connection.query<{ c: number }>({ text: 'select count(*) as c from __entitykit_migrations', values: [] });
        expect(afterRollback.rows[0]?.c).toBe(0);
        const table = await db.database.connection.query<{ c: number }>({
            text: 'select count(*) as c from information_schema.tables where table_schema = database() and table_name = \'mysql_things\'',
            values: [],
        });
        expect(table.rows[0]?.c).toBe(0);
    });
});
