import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { postgres } from '../packages/postgres/src';
import { createDb } from './aggregate-query-model/support';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class Report {
    public id = 0;
    public category = '';
    public amount = 0;
    public document: Record<string, unknown> = {};
}

class ReportContext extends DbContext {
    public reports = this.set(Report);
    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }
    protected override model(model: ModelBuilder): void {
        model.entity(Report, entity => {
            entity.toTable('boundary_reports');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer').isRequired();
            entity.property(row => row.category).hasColumnType('text').isRequired();
            entity.property(row => row.amount).hasColumnType('integer').isRequired();
            entity.property(row => row.document).hasColumnType('text').hasConversion({
                toProvider: value => JSON.stringify(value),
                fromProvider: (value: string) => JSON.parse(value) as Record<string, unknown>,
            });
        });
    }
}

async function open(): Promise<ReportContext> {
    const db = ReportContext.create();
    await db.database.ensureCreated();
    await db.database.connection.query({
        text: 'insert into boundary_reports (id, category, amount, document) values (?, ?, ?, ?), (?, ?, ?, ?), (?, ?, ?, ?)',
        values: [1, 'A', 10, '{"kind":"books"}', 2, 'A', 20, '{"kind":"books"}', 3, 'B', 30, '{"kind":"games"}'],
    });
    return db;
}

function expectPlain(result: Record<string, unknown>, expected: Record<string, unknown>): void {
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.keys(result)).toEqual(Object.keys(expected));
    for (const [key, value] of Object.entries(expected)) {
        expect(Object.getOwnPropertyDescriptor(result, key)).toEqual({
            value, enumerable: true, configurable: true, writable: true,
        });
    }
    expect(result).toEqual(expected);
    expect(JSON.stringify(result)).toBe(JSON.stringify(expected));
}

const aliases = ['__proto__', 'constructor', 'toString', 'ordinary'];
const aggregates = ['count', 'sum', 'avg', 'min', 'max'] as const;

describe('plain aggregate results with own aliases', () => {
    it.each(aliases.flatMap(alias => aggregates.map(operation => [alias, operation] as const)))(
        'materializes %s safely for %s against SQLite', async (alias, operation) => {
            const db = await open();
            try {
                const row = await db.reports.aggregate(aggregate => ({
                    [alias]: operation === 'count' ? aggregate.count() : aggregate[operation](report => report.amount),
                })).single();
                const expected = { count: 3, sum: 60, avg: 20, min: 10, max: 30 }[operation];
                expectPlain(row, { [alias]: expected });
                expect(db.changeTracker.entries()).toHaveLength(0);
            } finally {
                await db.dispose();
            }
        },
    );

    it.each(aliases)('materializes scalar grouped alias %s', async alias => {
        const db = await open();
        try {
            const rows = await db.reports.groupBy(report => ({ category: report.category }))
                .orderBy(group => group.key.category)
                .select(group => ({ [alias]: group.key.category, total: group.count() })).toArray();
            expect(rows).toHaveLength(2);
            expectPlain(rows[0], { [alias]: 'A', total: 2 });
            expectPlain(rows[1], { [alias]: 'B', total: 1 });
        } finally {
            await db.dispose();
        }
    });

    it.each(aliases)('materializes object-valued grouped alias %s without changing its prototype', async alias => {
        const db = await open();
        try {
            const rows = await db.reports.groupBy(report => ({ document: report.document }))
                .select(group => ({ [alias]: group.key.document, total: group.count() })).toArray();
            const row = rows.find(row => row.total === 2);
            if (!row) throw new Error('Missing grouped book rows.');
            expectPlain(row, { [alias]: { kind: 'books' }, total: 2 });
            expect(Object.prototype).not.toHaveProperty('kind');
        } finally {
            await db.dispose();
        }
    });

    it.each(aliases)('materializes date-bucket grouped alias %s as an own Date', async alias => {
        const connection = new RecordingDatabaseConnection();
        const db = createDb(connection);
        const day = new Date('2026-10-05T00:00:00Z');
        connection.queueResult({ rows: [{ [alias]: day.toISOString(), total: '2' }] });
        try {
            const row = await db.orders.groupBy(order => ({ day: postgres.dateBucket('day', order.createdAt, { timeZone: 'UTC' }) }))
                .select(group => ({ [alias]: group.key.day, total: group.count() })).single();
            expectPlain(row, { [alias]: day, total: 2 });
        } finally {
            await db.dispose();
        }
    });

    it('preserves own null results for an empty aggregate with a prototype-looking alias', async () => {
        const db = await open();
        try {
            const row = await db.reports.where(report => report.id.lt(0)).aggregate(aggregate => ({
                ['__proto__']: aggregate.min(report => report.amount), constructor: aggregate.count(),
            })).single();
            expectPlain(row, { ['__proto__']: null, constructor: 0 });
        } finally {
            await db.dispose();
        }
    });
});
