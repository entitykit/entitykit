import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext } from '../src';
import { postgresDialect } from '../src/providers/postgres';
import { sqliteDialect, sqliteProviderServices } from '../src/providers/sqlite';
import { SqlParameterBag } from '../src/sql/sql-statement';

/**
 * A multi-row insert is one statement, so its parameters are `rows × columns`.
 * Both providers cap that, at different numbers, and reject the statement at
 * the wire protocol with an error naming neither the limit nor the fix — so an
 * import that worked on Postgres failed on SQLite at a third the size.
 */
class Wide {
    public id!: string;
    public a!: string;
    public b!: string;
    public c!: string;
    public d!: string;
    public e!: string;
    public f!: string;

    constructor(data?: Partial<Wide>) {
        Object.assign(this, data);
    }
}

class WideDbContext extends DbContext {
    public wides = this.set(Wide);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Wide, entity => {
            entity.toTable('wides');
            entity.hasKey(wide => wide.id);
            for (const name of ['id', 'a', 'b', 'c', 'd', 'e', 'f'] as const) {
                entity.property(wide => wide[name]).hasColumnName(name).hasColumnType('text').isRequired();
            }
        });
    }
}

async function open(): Promise<WideDbContext> {
    const db =  WideDbContext.create();
    await db.database.connection.query({
        text: 'create table wides (id text primary key, a text not null, b text not null, c text not null, d text not null, e text not null, f text not null)',
        values: [],
    });
    return db;
}

function row(n: number): Wide {
    return new Wide({ id: `r${String(n)}`, a: 'a', b: 'b', c: 'c', d: 'd', e: 'e', f: 'f' });
}

describe('statement parameter limits', () => {
    it('declares a limit for every shipped dialect', () => {
    // Kept in the dialect rather than inferred from the provider name, the same
    // way ordering and paging parity are.
        expect(postgresDialect.maxStatementParameters?.()).toBe(65535);
        expect(sqliteDialect.maxStatementParameters?.()).toBe(32766);
    });

    it('splits a large insert into batches that fit', async () => {
    // 10_000 rows × 7 columns is 70_000 parameters: over both caps. Measured
    // before the fix, this raised Postgres 08P01 and SQLITE_ERROR.
        const db = await open();
        for (let index = 0; index < 10000; index++) {
            db.wides.add(row(index));
        }

        expect(await db.saveChanges()).toBe(10000);
        expect(await db.wides.count()).toBe(10000);
        await db.dispose();
    });

    it('keeps a split insert inside one transaction', async () => {
    // Splitting for the wire must not split the unit of work: if a later batch
    // fails, the earlier ones must not survive.
        const db = await open();

        // 32766 / 7 columns is 4680 rows per batch, so row 5000 lands in the
        // second one. Seeded directly, because the identity map would refuse a
        // duplicate key before it ever reached the database.
        await db.database.connection.query({
            text: 'insert into wides (id, a, b, c, d, e, f) values (\'r5000\', \'seed\', \'b\', \'c\', \'d\', \'e\', \'f\')',
            values: [],
        });

        for (let index = 0; index < 8000; index++) {
            db.wides.add(row(index));
        }

        await expect(db.saveChanges()).rejects.toThrow();

        db.changeTracker.clear();
        // Only the seeded row: the first batch committed nothing of its own.
        expect(await db.wides.count()).toBe(1);
        await db.dispose();
    });

    it('reports a filter too large to bind, naming the limit and an alternative', async () => {
    // Unlike an insert, this cannot be split: the parameter count is the number
    // of values. So it is refused before reaching the provider.
        const db = await open();
        const ids = Array.from({ length: 40000 }, (_, index) => `r${String(index)}`);

        expect(() => db.wides.where(wide => wide.id.in(ids)).toSql())
            .toThrow(/more than 32766 bound parameters, which is the most sqlite accepts.*temporary table/s);

        await db.dispose();
    });

    it('counts parameters per statement, not per session', async () => {
    // Two ordinary queries in a row must not accumulate toward the cap.
        const db = await open();
        db.wides.add(row(1));
        await db.saveChanges();
        db.changeTracker.clear();

        const ids = Array.from({ length: 20000 }, (_, index) => `r${String(index)}`);
        expect(await db.wides.where(wide => wide.id.in(ids)).count()).toBe(1);
        expect(await db.wides.where(wide => wide.id.in(ids)).count()).toBe(1);
        await db.dispose();
    });

    it('raises the limit at the boundary, not before it', () => {
        const bag = new SqlParameterBag(sqliteDialect);
        for (let index = 0; index < 32766; index++) {
            bag.add(index);
        }

        expect(bag.values.length).toBe(32766);
        expect(() => bag.add('one too many')).toThrow(/more than 32766 bound parameters/);
    });

    it('imposes no limit on a dialect that declares none', () => {
        const unlimited = { ...postgresDialect, maxStatementParameters: undefined };
        const bag = new SqlParameterBag(unlimited);
        for (let index = 0; index < 70000; index++) {
            bag.add(index);
        }

        expect(bag.values.length).toBe(70000);
    });
});
