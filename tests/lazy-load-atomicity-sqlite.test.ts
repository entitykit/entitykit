import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, EntityState, lazy } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';
import { requireDefined } from './support/require-defined';
import { refusalMessage, rejection } from './support/accessor-refusal-support';

class LazyPrincipal {
    public id = '';
    public dependents: LazyDependent[] = [];
}

class LazyDependent {
    public id = '';
    public principalId = '';
    public principal: LazyPrincipal | null = null;
}

class LazyRefusalContext extends DbContext {
    public principals = this.set(LazyPrincipal);
    public dependents = this.set(LazyDependent);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
        options.useLazyLoading();
    }

    protected override model(model: ModelBuilder): void {
        model.entity(LazyPrincipal, entity => {
            entity.toTable('lazy_principals');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
        });
        model.entity(LazyDependent, entity => {
            entity.toTable('lazy_dependents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.principalId)
                .hasColumnName('principal_id')
                .hasColumnType('text').isRequired();
            entity.hasOne(LazyPrincipal, row => row.principal)
                .withMany(row => row.dependents)
                .hasForeignKey(row => row.principalId);
        });
    }
}

async function openLazyGraph(): Promise<LazyRefusalContext> {
    const db = LazyRefusalContext.create();
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    await db.database.connection.query({
        text: 'insert into lazy_principals (id) values (?)', values: ['p1'],
    });
    await db.database.connection.query({
        text: 'insert into lazy_dependents (id, principal_id) values (?, ?)',
        values: ['d1', 'p1'],
    });
    return db;
}

/** Replace the inverse collection with a setter that refuses every value. */
function refuseDependents(principal: LazyPrincipal): void {
    const stored = principal.dependents;
    Object.defineProperty(principal, 'dependents', {
        configurable: true,
        enumerable: true,
        get: () => stored,
        set: () => undefined,
    });
}

describe('lazy load atomicity', () => {
    it('restores both sides when a lazy reference load is refused', async () => {
        const db = await openLazyGraph();
        const principal = requireDefined(await db.principals.find('p1'));
        const dependent = requireDefined(await db.dependents.find('d1'));
        refuseDependents(principal);
        const entry = requireDefined(db.entry(dependent));

        const failure = await rejection(async () =>
            lazy(dependent).principal);

        expect(refusalMessage(failure)).toBe(
            'Navigation \'LazyPrincipal.dependents\' refused its assigned value.',
        );
        expect(dependent.principal).toBeNull();
        expect(principal.dependents).toEqual([]);
        expect(entry.isNavigationLoaded('principal')).toBe(false);
        expect(entry.state).toBe(EntityState.Unchanged);
        await expect(db.principals.count()).resolves.toBe(1);
        await db.dispose();
    });

    it('detaches what a refused lazy collection load first tracked', async () => {
        const db = await openLazyGraph();
        const principal = requireDefined(await db.principals.find('p1'));
        refuseDependents(principal);

        const failure = await rejection(async () =>
            lazy(principal).dependents);

        expect(refusalMessage(failure)).toBe(
            'Navigation \'LazyPrincipal.dependents\' refused its assigned value.',
        );
        expect(principal.dependents).toEqual([]);
        expect(db.changeTracker.entries()).toHaveLength(1);
        expect(requireDefined(db.entry(principal))
            .isNavigationLoaded('dependents')).toBe(false);
        await db.dispose();
    });
});
