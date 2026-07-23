import type {
    DbContextOptionsBuilder,
    ModelBuilder,
} from '../../src';
import {
    DbContext,
} from '../../src';

/**
 * `avg(...)` returns the same full-precision result on every provider.
 *
 * MySQL's grouped `AVG` of an integer column returns a `DECIMAL` truncated to a
 * few decimal places, where Postgres `numeric` and SQLite `double` carry full
 * precision — so `avg` of the same rows was `10.3333` on MySQL and
 * `10.333333333333334` elsewhere. Averaging the column cast to `double` on MySQL
 * brings it in line (casting the *result* is not enough under `group by`).
 *
 * SQLite runs in-process (unconditional); Postgres and MySQL are gated.
 */
class Sample {
    public id!: string;
    public bucket!: string;
    public value!: number;
}

class MetricsContext extends DbContext {
    public static configureProvider: (options: DbContextOptionsBuilder) => void;

    public samples = this.set(Sample);

    protected override configure(options: DbContextOptionsBuilder): void {
        MetricsContext.configureProvider(options);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Sample, entity => {
            entity.toTable('avp_samples');
            entity.hasKey(s => s.id);
            entity.property(s => s.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(s => s.bucket).hasColumnName('bucket').hasColumnType('text').isRequired();
            entity.property(s => s.value).hasColumnName('value').hasColumnType('integer').isRequired();
        });
    }
}

function defineTests(label: string, configure: (options: DbContextOptionsBuilder) => void): void {
    describe(`avg precision (${label})`, () => {
        let db: MetricsContext;

        beforeEach(async () => {
            MetricsContext.configureProvider = configure;
            db =  MetricsContext.create();
            await db.database.connection.query({ text: 'drop table if exists avp_samples', values: [] });
            for (const statement of db.database.createScript().split(';').map(s => s.trim()).filter(Boolean)) {
                await db.database.connection.query({ text: statement, values: [] });
            }
            // bucket "x": 10, 20, 1 -> avg 31/3 = 10.3333... (repeating)
            db.samples.add(Object.assign(new Sample(), { id: 's1', bucket: 'x', value: 10 }));
            db.samples.add(Object.assign(new Sample(), { id: 's2', bucket: 'x', value: 20 }));
            db.samples.add(Object.assign(new Sample(), { id: 's3', bucket: 'x', value: 1 }));
            await db.saveChanges();
            db.changeTracker.clear();
        });

        afterEach(async () => {
            await db.database.connection.query({ text: 'drop table if exists avp_samples', values: [] });
            await db.dispose();
        });

        it('keeps a repeating-decimal grouped average at full double precision', async () => {
            const rows = await db.samples
                .groupBy(s => ({ bucket: s.bucket }))
                .select(g => ({ bucket: g.key.bucket, average: g.avg(s => s.value) }))
                .toArray();

            // 10.3333 (MySQL's truncated DECIMAL) is off by ~3e-4 and fails at 10
            // digits; only the full-precision double (matching Postgres and SQLite)
            // passes. Every provider must agree with the JS-computed average.
            expect(rows[0]?.average).toBeCloseTo(31 / 3, 10);
        });
    });
}

defineTests('SQLite', options => options.useSqlite(':memory:'));

const postgresUrl = process.env.DATABASE_URL;
if (process.env.RUN_POSTGRES_TESTS === 'true' && postgresUrl) {
    defineTests('Postgres', options => options.usePostgres(postgresUrl));
}

const mysqlUrl = process.env.MYSQL_URL ?? process.env.MYSQL_DATABASE_URL;
if (process.env.RUN_MYSQL_TESTS === 'true' && mysqlUrl) {
    defineTests('MySQL', options => options.useMySql(mysqlUrl));
}
