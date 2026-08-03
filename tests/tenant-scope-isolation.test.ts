import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, TenantScopeUnavailableError } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';
import { requireDefined } from './support/require-defined';

/**
 * Tenant scope is an isolation boundary. These tests exist because it used to
 * be dropped by `ignoreQueryFilters()`, whose ordinary use is "also show me the
 * deleted rows" — so asking for deleted rows silently returned every tenant's.
 */
class Doc {
    public id!: string;
    public tenantId!: string;
    public title!: string;
    public deletedAt!: Date | null;

    constructor(data?: Partial<Doc>) {
        Object.assign(this, data);
    }
}

let currentTenant: string | undefined = 't1';

class ScopedDbContext extends DbContext {
    public docs = this.set(Doc);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
        options.useTenantScope(() => currentTenant);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Doc, entity => {
            entity.toTable('docs');
            entity.hasKey(doc => doc.id);
            entity.property(doc => doc.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(doc => doc.tenantId).hasColumnName('tenant_id').hasColumnType('text').isRequired();
            entity.property(doc => doc.title).hasColumnName('title').hasColumnType('text').isRequired();
            entity.property(doc => doc.deletedAt).hasColumnName('deleted_at').hasColumnType('timestamptz');
            entity.tenantKey(doc => doc.tenantId);
            entity.softDelete(doc => doc.deletedAt);
        });
    }
}

async function seed(): Promise<ScopedDbContext> {
    currentTenant = 't1';
    const db =  ScopedDbContext.create();
    await db.database.connection.query({
        text: 'create table docs (id text primary key, tenant_id text not null, title text not null, deleted_at text)',
        values: [],
    });

    // Two tenants, each with one live and one soft-deleted document. Seeded one
    // tenant at a time because the write path already refuses to persist a row
    // belonging to a tenant other than the current one.
    const deleted = new Date('2026-01-01T00:00:00.000Z');
    for (const tenant of ['t1', 't2']) {
        currentTenant = tenant;
        db.docs.add(new Doc({ id: `${tenant}-live`, tenantId: tenant, title: `${tenant} live`, deletedAt: null }));
        db.docs.add(new Doc({ id: `${tenant}-gone`, tenantId: tenant, title: `${tenant} deleted`, deletedAt: deleted }));
        await db.saveChanges();
        db.changeTracker.clear();
    }

    currentTenant = 't1';
    return db;
}

describe('tenant scope isolation', () => {
    let db: ScopedDbContext;

    beforeEach(async () => {
        db = await seed();
    });

    afterEach(async () => {
        await db.dispose();
    });

    async function ids(query: Promise<Doc[]>): Promise<string[]> {
        return (await query).map(doc => doc.id).sort();
    }

    it('scopes an ordinary query to the current tenant and hides deleted rows', async () => {
        expect(await ids(db.docs.toArray())).toEqual(['t1-live']);
    });

    it('keeps tenant scope when query filters are ignored', async () => {
    // The whole point: this asks for the deleted rows, not for other tenants.
        expect(await ids(db.docs.ignoreQueryFilters().toArray())).toEqual(['t1-gone', 't1-live']);
    });

    it('crosses tenants only through ignoreTenantScope, still hiding deleted rows', async () => {
        expect(await ids(db.docs.ignoreTenantScope().toArray())).toEqual(['t1-live', 't2-live']);
    });

    it('returns everything when both opt-outs are combined', async () => {
        expect(await ids(db.docs.ignoreQueryFilters().ignoreTenantScope().toArray()))
            .toEqual(['t1-gone', 't1-live', 't2-gone', 't2-live']);
    });

    it('keeps tenant scope on counts, projections, and existence checks', async () => {
        expect(await db.docs.ignoreQueryFilters().count()).toBe(2);
        const titles = await db.docs.ignoreQueryFilters().select(doc => ({ title: doc.title })).toArray();
        expect(titles.map(row => row.title).sort()).toEqual(['t1 deleted', 't1 live']);
        expect(await db.docs.ignoreQueryFilters().where(doc => doc.id.eq('t2-live')).exists()).toBe(false);
    });

    it('recovery reads include soft-deleted rows but retain tenant scope', async () => {
        const doc = await db.docs.find('t1-live');
        await db.database.connection.query({
            text: 'update docs set deleted_at = ? where id = ?',
            values: ['2026-02-01T00:00:00.000Z', 't1-live'],
        });
        const entry = requireDefined(db.entry(requireDefined(doc)));

        const databaseValues = requireDefined(
            await entry.getDatabaseValues(),
        );
        expect(databaseValues.get('deletedAt')).toBeInstanceOf(Date);

        currentTenant = 't2';
        await expect(entry.getDatabaseValues()).resolves.toBeNull();
    });

    it('keeps tenant scope on a bulk delete', async () => {
    // The most damaging form of the leak: a set-based delete that ignores query
    // filters would have removed every tenant's rows, not just this tenant's.
        const removed = await db.docs.ignoreQueryFilters().where(doc => doc.title.like('%')).executeDelete();
        expect(removed).toBe(2);

        const survivors = await db.docs.ignoreQueryFilters().ignoreTenantScope().toArray();
        expect(survivors.map(doc => doc.id).sort()).toEqual(['t2-gone', 't2-live']);
    });

    it('keeps tenant scope on a bulk update', async () => {
        const updated = await db.docs.ignoreQueryFilters().where(doc => doc.title.like('%')).executeUpdate({ title: 'renamed' });
        expect(updated).toBe(2);

        const all = await db.docs.ignoreQueryFilters().ignoreTenantScope().toArray();
        const renamed = all.filter(doc => doc.title === 'renamed').map(doc => doc.id).sort();
        expect(renamed).toEqual(['t1-gone', 't1-live']);
    });

    it('keeps tenant scope on the joined side of a join', async () => {
        const joined = await db.docs
            .ignoreQueryFilters()
            .join('other', db.docs, sources => sources.root.tenantId.eq(sources.other.tenantId))
            .select(sources => ({ left: sources.root.id, right: sources.other.id }))
            .toArray();

        const seen = [...new Set(joined.flatMap(row => [row.left, row.right]))];
        expect(seen.length).toBeGreaterThan(0);
        expect(seen.every(id => id.startsWith('t1-'))).toBe(true);
    });

    it('fails closed when the current tenant disappears', async () => {
        currentTenant = undefined;

        await expect(db.docs.toArray()).rejects.toBeInstanceOf(
            TenantScopeUnavailableError,
        );
        await expect(db.docs.where(doc => doc.id.eq('t1-live')).executeDelete())
            .rejects.toBeInstanceOf(TenantScopeUnavailableError);

        const rogue = new Doc({
            id: 'rogue',
            tenantId: 't9',
            title: 'Rogue',
            deletedAt: null,
        });
        db.docs.add(rogue);
        await expect(db.saveChanges()).rejects.toBeInstanceOf(
            TenantScopeUnavailableError,
        );
        expect(db.entry(rogue)?.state).toBe('Added');
    });

    it('does not return a cross-tenant entity cached by an administrative query', async () => {
        const cached = await db.docs.ignoreTenantScope()
            .where(doc => doc.id.eq('t2-live'))
            .single();

        await expect(db.docs.find('t2-live')).resolves.toBeNull();
        expect(db.entry(cached)).toBeDefined();
    });

    it('does not return a soft-deleted entity cached by an unfiltered query', async () => {
        const cached = await db.docs.ignoreQueryFilters()
            .where(doc => doc.id.eq('t1-gone'))
            .single();

        await expect(db.docs.find('t1-gone')).resolves.toBeNull();
        expect(db.entry(cached)).toBeDefined();
    });

    it('fails closed when the tenant disappears after an entity was cached', async () => {
        await expect(db.docs.find('t1-live')).resolves.toBeDefined();
        currentTenant = undefined;

        await expect(db.docs.find('t1-live')).rejects.toBeInstanceOf(
            TenantScopeUnavailableError,
        );
    });

    it('allows an explicit query-level escape when no tenant exists', async () => {
        currentTenant = undefined;

        expect(await ids(db.docs.ignoreTenantScope().toArray()))
            .toEqual(['t1-live', 't2-live']);
    });
});
