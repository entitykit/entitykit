import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext, DeleteBehavior, EntityState } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { requireDefined } from './support/require-defined';
import { internalEntityEntry } from './support/public-api-internals';
import { rejection } from './support/accessor-refusal-support';

class CascadePrincipal {
    public id = '';
    public dependents: CascadeDependent[] = [];
}

class CascadeDependent {
    public id = '';
    public principalId = '';
    public principal: CascadePrincipal | null = null;
}

/** SQLite graph whose dependents are required and cascade with their principal. */
class CascadeContext extends DbContext {
    public principals = this.set(CascadePrincipal);
    public dependents = this.set(CascadeDependent);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(CascadePrincipal, entity => {
            entity.toTable('cascade_principals');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
        });
        model.entity(CascadeDependent, entity => {
            entity.toTable('cascade_dependents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.principalId)
                .hasColumnName('principal_id')
                .hasColumnType('text').isRequired();
            entity.hasOne(CascadePrincipal, row => row.principal)
                .withMany(row => row.dependents)
                .hasForeignKey(row => row.principalId)
                .onDelete(DeleteBehavior.Cascade);
        });
    }
}

/** Two principals, each owning one dependent. */
async function openCascadeGraph(): Promise<CascadeContext> {
    const db = CascadeContext.create();
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    await db.database.connection.query({
        text: 'insert into cascade_principals (id) values (?), (?)',
        values: ['p1', 'p2'],
    });
    await db.database.connection.query({
        text: `insert into cascade_dependents (id, principal_id)
            values (?, ?), (?, ?)`,
        values: ['d1', 'p1', 'd2', 'p2'],
    });
    return db;
}

/** Read both tables directly, as `principal/dependent` pairs in a stable order. */
async function storedRows(db: CascadeContext): Promise<string[]> {
    const principals = await db.database.connection.query<{ id: string }>({
        text: 'select id from cascade_principals order by id', values: [],
    });
    const dependents = await db.database.connection.query<{
        id: string; principal_id: string;
    }>({
        text: `select id, principal_id from cascade_dependents
            order by id`,
        values: [],
    });
    return [
        ...principals.rows.map(row => `principal:${row.id}`),
        ...dependents.rows.map(row => `dependent:${row.id}@${row.principal_id}`),
    ];
}

/** Replace the inverse collection with a setter that refuses every value. */
function refuseDependents(principal: CascadePrincipal): void {
    const stored = principal.dependents;
    Object.defineProperty(principal, 'dependents', {
        configurable: true,
        enumerable: true,
        get: () => stored,
        set: () => undefined,
    });
}

describe('navigation load suppression checkpoint', () => {
    it('restores change-detection suppression a failed include cleared', async () => {
        const db = await openCascadeGraph();
        const first = requireDefined(await db.principals.find('p1'));
        const second = requireDefined(await db.principals.find('p2'));
        const entry = requireDefined(db.entry(first));
        await entry.collection(row => row.dependents).load();
        const kept = requireDefined(first.dependents[0]);
        // The application deliberately stops trusting this collection as loaded.
        internalEntityEntry(entry).markNavigationNotLoaded('dependents');
        refuseDependents(second);

        await rejection(async () => db.principals
            .orderBy(row => row.id).include(row => row.dependents).toArray());
        first.dependents.splice(0, 1);
        db.changeTracker.detectChanges();

        // Suppression survived, so the partial collection is not read as an
        // orphaned dependent and the cascade never fires.
        expect(requireDefined(db.entry(kept)).state)
            .toBe(EntityState.Unchanged);
        await expect(db.saveChanges()).resolves.toBe(0);
        await expect(storedRows(db)).resolves.toEqual([
            'principal:p1', 'principal:p2',
            'dependent:d1@p1', 'dependent:d2@p2',
        ]);
        await db.dispose();
    });

    it('leaves the database untouched after a failed cascade-graph include', async () => {
        const db = await openCascadeGraph();
        const before = await storedRows(db);
        const second = requireDefined(await db.principals.find('p2'));
        refuseDependents(second);

        await rejection(async () => db.principals
            .orderBy(row => row.id).include(row => row.dependents).toArray());
        db.changeTracker.detectChanges();

        expect(db.changeTracker.entries().map(row => row.state)).toEqual(
            db.changeTracker.entries().map(() => EntityState.Unchanged),
        );
        await expect(db.saveChanges()).resolves.toBe(0);
        await expect(storedRows(db)).resolves.toEqual(before);
        await db.dispose();
    });
});
