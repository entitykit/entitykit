import { requireDefined } from '../require-defined';
import { EntityState } from '../../../src';
import { ProviderContractValue } from './model';
import { seedAggregateValues } from './seed-data';
import type { ProviderContractTestContext } from './test-context';

export function defineValueProviderContractTests(context: ProviderContractTestContext): void {
    it('reads mapped column types back as the JavaScript values the model declares', async () => {
        const { db, runtime } = context;
        if (!runtime.prepareValueRoundTrip) {
            // Providers without real storage replay queued rows, so there is no
            // stored value to convert and nothing to prove here.
            expect(runtime.providerServices.valueReader).toBeUndefined();
            return;
        }

        await runtime.prepareValueRoundTrip(db);

        const recordedAt = new Date('2026-03-04T05:06:07.000Z');
        db.values.add(new ProviderContractValue({
            id: 'value_1',
            isActive: true,
            recordedAt,
            payload: { unit: 'celsius', samples: [1, 2, 3] },
            score: 42,
        }));
        db.values.add(new ProviderContractValue({
            id: 'value_2',
            isActive: false,
            recordedAt: new Date('2026-05-06T07:08:09.000Z'),
            payload: { unit: 'kelvin', samples: [] },
            score: 7,
        }));
        await db.saveChanges();
        // Drop identity-map hits so reads come back through materialization.
        db.changeTracker.clear();

        const value = await db.values.find('value_1');
        expect(value).not.toBeNull();
        // Strict equality matters: a driver returning `1` for a boolean passes a
        // truthiness check but fails here.
        expect(requireDefined(value).isActive).toBe(true);
        expect(requireDefined(value).recordedAt).toBeInstanceOf(Date);
        expect(requireDefined(value).recordedAt.getTime()).toBe(recordedAt.getTime());
        expect(requireDefined(value).payload).toEqual({ unit: 'celsius', samples: [1, 2, 3] });
        expect(requireDefined(value).score).toBe(42);

        // A freshly materialized entity must not look dirty.
        expect(db.changeTracker.entries().filter(entry => entry.state === EntityState.Modified)).toHaveLength(0);

        // Projections and aggregates read rows on their own paths.
        db.changeTracker.clear();
        const projected = await db.values
            .where(row => row.isActive.eq(true))
            .select(row => ({ id: row.id, active: row.isActive, at: row.recordedAt, body: row.payload }))
            .toArray();
        expect(projected).toHaveLength(1);
        expect(projected[0].active).toBe(true);
        expect(projected[0].at).toBeInstanceOf(Date);
        expect(projected[0].at.getTime()).toBe(recordedAt.getTime());
        expect(projected[0].body).toEqual({ unit: 'celsius', samples: [1, 2, 3] });

        const summary = await db.values
            .aggregate(agg => ({
                valueCount: agg.count(),
                earliest: agg.min(row => row.recordedAt),
                totalScore: agg.sum(row => row.score),
            }))
            .single();
        expect(summary.valueCount).toBe(2);
        expect(summary.earliest).toBeInstanceOf(Date);
        expect(requireDefined(summary.earliest).getTime()).toBe(recordedAt.getTime());
        expect(Number(summary.totalScore)).toBe(49);
    });

    it('computes count, sum, avg, min, and max the same way on every provider', async () => {
        const { db, runtime } = context;
        if (!runtime.prepareValueRoundTrip) {
            return;
        }
        await runtime.prepareValueRoundTrip(db);
        await seedAggregateValues(db);

        const summary = await db.values
            .aggregate(agg => ({
                total: agg.count(),
                sum: agg.sum(row => row.score),
                avg: agg.avg(row => row.score),
                low: agg.min(row => row.score),
                high: agg.max(row => row.score),
            }))
            .single();

        // Computed columns, not mapped properties: a provider may hand back a
        // string for sum/avg (Postgres bigint/numeric), so compare numerically.
        expect(summary.total).toBe(4);
        expect(Number(summary.sum)).toBe(100);
        expect(Number(summary.avg)).toBe(25);
        expect(Number(summary.low)).toBe(10);
        expect(Number(summary.high)).toBe(40);
    });

    it('groups by a boolean column and aggregates per group the same way', async () => {
        const { db, runtime } = context;
        if (!runtime.prepareValueRoundTrip) {
            return;
        }
        await runtime.prepareValueRoundTrip(db);
        await seedAggregateValues(db);

        const groups = await db.values
            .groupBy(row => ({ active: row.isActive }))
            .orderBy(group => group.key.active)
            .select(group => ({ active: group.key.active, count: group.count(), total: group.sum(row => row.score) }))
            .toArray();

        expect(groups).toHaveLength(2);
        // The group key is the model's boolean, not the driver's 0/1 — a provider
        // that hands back `1` (MySQL's tinyint) would fail this strict equality.
        expect(groups.map(group => group.active)).toEqual([false, true]);
        const byActive = new Map(groups.map(group => [group.active, group]));
        expect(requireDefined(byActive.get(false)).count).toBe(2);
        expect(Number(requireDefined(byActive.get(false)).total)).toBe(70);
        expect(requireDefined(byActive.get(true)).count).toBe(2);
        expect(Number(requireDefined(byActive.get(true)).total)).toBe(30);
    });

    it('filters with comparisons, in, and combined predicates the same way', async () => {
        const { db, runtime } = context;
        if (!runtime.prepareValueRoundTrip) {
            return;
        }
        await runtime.prepareValueRoundTrip(db);
        await seedAggregateValues(db);

        const ids = async (build: (query: typeof db.values) => { toArray(): Promise<ProviderContractValue[]> }): Promise<string[]> =>
            (await build(db.values).toArray()).map(value => value.id).sort();

        expect(await ids(query => query.where(value => value.score.gt(20)))).toEqual(['a3', 'a4']);
        expect(await ids(query => query.where(value => value.score.gte(20)))).toEqual(['a2', 'a3', 'a4']);
        expect(await ids(query => query.where(value => value.score.lt(20)))).toEqual(['a1']);
        expect(await ids(query => query.where(value => value.id.in(['a1', 'a4'])))).toEqual(['a1', 'a4']);
        expect(await ids(query => query.where(value => value.isActive.eq(true)))).toEqual(['a1', 'a2']);
        // Combined predicate: score > 10 AND not active.
        expect(await ids(query => query.where(value => value.score.gt(10).and(value.isActive.eq(false))))).toEqual(['a3', 'a4']);
    });
}
