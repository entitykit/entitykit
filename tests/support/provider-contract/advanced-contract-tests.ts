import { UniqueConstraintError } from '../../../packages/core/src';
import { ProviderContractValue } from './model';
import type { ProviderContractTestContext } from './test-context';

export function defineAdvancedProviderContractTests(context: ProviderContractTestContext): void {
    it('orders nulls and matches text case the same way on every provider', async () => {
        const { db, runtime } = context;
        if (!runtime.prepareValueRoundTrip) {
            // Needs real storage; providers replaying queued rows cannot show this.
            return;
        }

        await runtime.prepareValueRoundTrip(db);

        const at = new Date('2026-03-04T05:06:07.000Z');
        const payload = { unit: 'celsius', samples: [] };
        db.values.add(new ProviderContractValue({ id: 'v1', isActive: true, recordedAt: at, payload, score: 1, label: 'Alpha' }));
        db.values.add(new ProviderContractValue({ id: 'v2', isActive: true, recordedAt: at, payload, score: 2, label: null }));
        db.values.add(new ProviderContractValue({ id: 'v3', isActive: true, recordedAt: at, payload, score: 3, label: 'beta' }));
        await db.saveChanges();
        db.changeTracker.clear();

        // Nulls sort as greater than non-nulls: last ascending, first descending.
        // Providers whose native default differs must state it in the SQL, or a
        // paged query returns different rows depending on the provider.
        //
        // "Alpha" and "beta" are deliberate: they order the same under byte
        // collation (A=65 < b=98) and under linguistic collation (alpha < beta).
        // Relative order of *text* is the server's collation, which EntityKit
        // does not control, so only collation-independent values belong here.
        const ascending = await db.values.orderBy(value => value.label).toArray();
        expect(ascending.map(value => value.id)).toEqual(['v1', 'v3', 'v2']);

        const descending = await db.values.orderByDescending(value => value.label).toArray();
        expect(descending.map(value => value.id)).toEqual(['v2', 'v3', 'v1']);

        // `like` is case-sensitive. SQLite's native default is not, so a search
        // built on it would otherwise match different rows per provider.
        db.changeTracker.clear();
        expect((await db.values.where(value => value.label.like('A%')).toArray()).map(value => value.id)).toEqual(['v1']);
        expect(await db.values.where(value => value.label.like('a%')).toArray()).toEqual([]);
        expect(await db.values.where(value => value.label.like('B%')).toArray()).toEqual([]);
        expect((await db.values.where(value => value.label.like('b%')).toArray()).map(value => value.id)).toEqual(['v3']);
    });

    it('pages and matches text the same way on every provider', async () => {
        const { db, runtime } = context;
        if (!runtime.prepareValueRoundTrip) {
            return;
        }

        await runtime.prepareValueRoundTrip(db);

        const at = new Date('2026-03-04T05:06:07.000Z');
        const payload = { unit: 'celsius', samples: [] };
        for (const [id, score, label] of [['p1', 1, 'Alpha'], ['p2', 2, 'beta'], ['p3', 3, 'Gamma']] as const) {
            db.values.add(new ProviderContractValue({ id, isActive: true, recordedAt: at, payload, score, label }));
        }
        await db.saveChanges();
        db.changeTracker.clear();

        // `skip` without `take`: valid on Postgres, but SQLite rejects a bare
        // offset, so the dialect supplies the limit literal it needs.
        const skipped = await db.values.orderBy(value => value.score).skip(1).toArray();
        expect(skipped.map(value => value.id)).toEqual(['p2', 'p3']);

        const page = await db.values.orderBy(value => value.score).skip(1).take(1).toArray();
        expect(page.map(value => value.id)).toEqual(['p2']);

        expect(await db.values.orderBy(value => value.score).take(0).toArray()).toEqual([]);
        expect(await db.values.orderBy(value => value.score).skip(99).take(5).toArray()).toEqual([]);

        // An empty `in` matches nothing rather than producing invalid SQL.
        expect(await db.values.where(value => value.id.in([])).toArray()).toEqual([]);

        // contains/startsWith/endsWith compile to `like`, so they inherit its
        // case sensitivity and must agree across providers.
        db.changeTracker.clear();
        expect((await db.values.where(value => value.label.contains('lph')).toArray()).map(value => value.id)).toEqual(['p1']);
        expect(await db.values.where(value => value.label.contains('LPH')).toArray()).toEqual([]);
        expect((await db.values.where(value => value.label.startsWith('G')).toArray()).map(value => value.id)).toEqual(['p3']);
        expect(await db.values.where(value => value.label.startsWith('g')).toArray()).toEqual([]);
        expect((await db.values.where(value => value.label.endsWith('mma')).toArray()).map(value => value.id)).toEqual(['p3']);
        expect(await db.values.where(value => value.label.endsWith('MMA')).toArray()).toEqual([]);
    });

    it('declares how many parameters one statement may bind', () => {
        const { db, runtime } = context;
        // A multi-row insert is one statement, so its parameters are
        // rows x columns. A provider that declares no cap lets a large save be
        // built past its own limit and rejected at the wire protocol, with an
        // error naming neither the limit nor the fix.
        expect(contextOptions(db).dialect.maxStatementParameters?.() ?? null)
            .toBe(runtime.expectedMaxStatementParameters);
    });

    it('saves more rows than one statement can bind', async () => {
        const { db, runtime } = context;
        if (!runtime.prepareValueRoundTrip || runtime.expectedMaxStatementParameters === null) {
            return;
        }

        await runtime.prepareValueRoundTrip(db);

        const limit = runtime.expectedMaxStatementParameters;
        const columns = 6;
        const rows = Math.floor(limit / columns) + 50;

        const at = new Date('2026-03-04T05:06:07.000Z');
        for (let index = 0; index < rows; index++) {
            db.values.add(new ProviderContractValue({
                id: `bulk_${String(index)}`,
                isActive: true,
                recordedAt: at,
                payload: { unit: 'celsius', samples: [] },
                score: index,
                label: null,
            }));
        }

        expect(await db.saveChanges()).toBe(rows);
        db.changeTracker.clear();
        expect(await db.values.count()).toBe(rows);
    }, 120000);

    it('declares whether it can express an upsert', () => {
        const { db, runtime } = context;
        expect(Boolean(contextOptions(db).dialect.upsertClause?.(['id'], ['label'])))
            .toBe(runtime.expectedSupportsUpsert);
    });

    it('upserts, inserting what is missing and overwriting what is not', async () => {
        const { db, runtime } = context;
        if (!runtime.prepareValueRoundTrip || !runtime.expectedSupportsUpsert) {
            return;
        }

        await runtime.prepareValueRoundTrip(db);

        const at = new Date('2026-03-04T05:06:07.000Z');
        const payload = { unit: 'celsius', samples: [] };
        const make = (id: string, score: number, label: string): ProviderContractValue =>
            new ProviderContractValue({ id, isActive: true, recordedAt: at, payload, score, label });

        expect(await db.values.upsert([make('u1', 1, 'first'), make('u2', 2, 'second')])).toBe(2);
        db.changeTracker.clear();

        // One existing, one new: the existing row is overwritten in place.
        await db.values.upsert([make('u1', 10, 'updated'), make('u3', 3, 'third')]);
        db.changeTracker.clear();

        const rows = await db.values.orderBy(value => value.id).toArray();
        expect(rows.map(row => row.id)).toEqual(['u1', 'u2', 'u3']);
        expect(rows[0]).toMatchObject({ score: 10, label: 'updated' });
    });

    it('classifies a constraint violation the same way on every provider', async () => {
        const { db, runtime } = context;
        if (!runtime.prepareValueRoundTrip) {
            return;
        }

        await runtime.prepareValueRoundTrip(db);

        const at = new Date('2026-03-04T05:06:07.000Z');
        const payload = { unit: 'celsius', samples: [] };
        db.values.add(new ProviderContractValue({ id: 'dup', isActive: true, recordedAt: at, payload, score: 1, label: 'first' }));
        await db.saveChanges();
        db.changeTracker.clear();

        // Applications branch on the error type to tell "already exists" from a
        // genuine fault, so an unclassified provider error is a behavioral
        // difference, not just a cosmetic one.
        db.values.add(new ProviderContractValue({ id: 'dup', isActive: true, recordedAt: at, payload, score: 2, label: 'second' }));
        await expect(db.saveChanges()).rejects.toBeInstanceOf(UniqueConstraintError);
    });

    it('surfaces provider errors with provider metadata', async () => {
        const { db, runtime } = context;
        await runtime.expectProviderError(db);
    });
}
import { contextOptions } from '../public-api-internals';
