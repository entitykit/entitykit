import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import {
    DbContext,
    DbUpdateConcurrencyError,
    DeleteBehavior,
    TenantOwnershipError,
    valueConverter,
} from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';
import { requireDefined } from './support/require-defined';

class OwnedParent {
    public id = '';
    public tenantId = '';
    public children: OwnedChild[] = [];
    public profile: OwnedProfile | null = null;
}

class OwnedChild {
    public id = '';
    public tenantId = '';
    public parentId = '';
    public parent: OwnedParent | null = null;
}

class OwnedProfile {
    public id = '';
    public tenantId = '';
    public parentId = '';
    public parent: OwnedParent | null = null;
}

const tenantConverter = valueConverter<string, string>({
    toProvider: value => value.toLowerCase(),
    fromProvider: value => value.toUpperCase(),
});

class TenantRelationshipWriteContext extends DbContext {
    public parents = this.set(OwnedParent);
    public children = this.set(OwnedChild);
    public profiles = this.set(OwnedProfile);

    constructor(private readonly crossTenant = false) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        const configured = options.useProvider(sqliteProviderServices, ':memory:');
        if (this.crossTenant) configured.allowCrossTenantAccess();
        else configured.useTenantScope(() => 't1');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(OwnedParent, entity => {
            entity.toTable('owned_parents');
            entity.hasKey(row => row.id);
            entity.tenantKey(row => row.tenantId);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').hasConversion(tenantConverter)
                .isRequired();
        });
        model.entity(OwnedChild, entity => {
            entity.toTable('owned_children');
            entity.hasKey(row => row.id);
            entity.tenantKey(row => row.tenantId);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').hasConversion(tenantConverter)
                .isRequired();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('text').isRequired();
            entity.hasOne(OwnedParent, row => row.parent)
                .withMany(row => row.children)
                .hasForeignKey(row => row.parentId)
                .onDelete(DeleteBehavior.Cascade);
        });
        model.entity(OwnedProfile, entity => {
            entity.toTable('owned_profiles');
            entity.hasKey(row => row.id);
            entity.tenantKey(row => row.tenantId);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').hasConversion(tenantConverter)
                .isRequired();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('text').isRequired();
            entity.hasOne(OwnedParent, row => row.parent)
                .withOne(row => row.profile)
                .hasForeignKey(row => row.parentId)
                .onDelete(DeleteBehavior.Cascade);
        });
    }
}

class GeneratedOwnedParent {
    public id = 0;
    public tenantId = '';
    public children: GeneratedOwnedChild[] = [];
}

class GeneratedOwnedChild {
    public id = '';
    public tenantId = '';
    public parentId = 0;
    public parent!: GeneratedOwnedParent;
}

class GeneratedTenantRelationshipContext extends DbContext {
    public parents = this.set(GeneratedOwnedParent);
    public children = this.set(GeneratedOwnedChild);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:')
            .useTenantScope(() => 't1');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(GeneratedOwnedParent, entity => {
            entity.toTable('generated_owned_parents');
            entity.hasKey(row => row.id);
            entity.tenantKey(row => row.tenantId);
            entity.property(row => row.id).hasColumnType('integer')
                .isRequired().useSqliteRowId();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').isRequired();
        });
        model.entity(GeneratedOwnedChild, entity => {
            entity.toTable('generated_owned_children');
            entity.hasKey(row => row.id);
            entity.tenantKey(row => row.tenantId);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('integer').isRequired();
            entity.hasOne(GeneratedOwnedParent, row => row.parent)
                .withMany(row => row.children)
                .hasForeignKey(row => row.parentId);
        });
    }
}

async function open(crossTenant = false): Promise<TenantRelationshipWriteContext> {
    const db = TenantRelationshipWriteContext.create(crossTenant);
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    await db.database.connection.query({
        text: 'insert into owned_parents (id, tenant_id) values (?, ?), (?, ?)',
        values: ['p1', 't1', 'p2', 't2'],
    });
    await db.database.connection.query({
        text: 'insert into owned_children (id, tenant_id, parent_id) values (?, ?, ?)',
        values: ['c1', 't1', 'p1'],
    });
    await db.database.connection.query({
        text: 'insert into owned_profiles (id, tenant_id, parent_id) values (?, ?, ?)',
        values: ['f1', 't1', 'p1'],
    });
    return db;
}

async function storedParent(
    db: TenantRelationshipWriteContext,
    table: 'owned_children' | 'owned_profiles' = 'owned_children',
): Promise<string> {
    const result = await db.database.connection.query<{ parent_id: string }>({
        text: `select parent_id from ${table} where tenant_id = ?`,
        values: ['t1'],
    });
    return requireDefined(result.rows[0]).parent_id;
}

describe('tenant-owned ordinary relationship writes', () => {
    it('rejects a scalar foreign key update to another tenant', async () => {
        const db = await open();
        const child = requireDefined(await db.children.find('c1'));
        child.parentId = 'p2';

        await expect(db.saveChanges()).rejects.toBeInstanceOf(
            DbUpdateConcurrencyError,
        );
        expect(await storedParent(db)).toBe('p1');
        await db.dispose();
    });

    it('rejects an untracked principal object from another tenant', async () => {
        const db = await open();
        const child = requireDefined(await db.children.find('c1'));
        child.parent = Object.assign(new OwnedParent(), {
            id: 'p2', tenantId: 't2',
        });

        await expect(db.saveChanges()).rejects.toBeInstanceOf(
            TenantOwnershipError,
        );
        expect(child.parentId).toBe('p1');
        expect(await storedParent(db)).toBe('p1');
        await db.dispose();
    });

    it('rejects a tracked principal from another tenant', async () => {
        const db = await open();
        const other = await db.parents.ignoreTenantScope()
            .where(row => row.tenantId.eq('t2')).single();
        const child = requireDefined(await db.children.find('c1'));
        child.parent = other;

        await expect(db.saveChanges()).rejects.toBeInstanceOf(
            TenantOwnershipError,
        );
        expect(await storedParent(db)).toBe('p1');
        await db.dispose();
    });

    it('compares untracked tenant identities through provider conversion', async () => {
        const db = await open();
        const child = requireDefined(await db.children.find('c1'));
        child.parent = Object.assign(new OwnedParent(), {
            id: 'p1', tenantId: 't1',
        });

        expect(() => {
            db.changeTracker.detectChanges();
        }).not.toThrow();
        expect(child.parentId).toBe('p1');
        await expect(db.saveChanges()).resolves.toBe(0);
        await db.dispose();
    });

    it('rejects an inserted dependent whose scalar FK targets another tenant', async () => {
        const db = await open();
        db.children.add(Object.assign(new OwnedChild(), {
            id: 'c2', tenantId: 't1', parentId: 'p2',
        }));

        await expect(db.saveChanges()).rejects.toBeInstanceOf(
            DbUpdateConcurrencyError,
        );
        expect(await db.children.count()).toBe(1);
        await db.dispose();
    });

    it('applies the same ownership gate to one-to-one writes', async () => {
        const db = await open();
        const profile = requireDefined(await db.profiles.find('f1'));
        profile.parentId = 'p2';

        await expect(db.saveChanges()).rejects.toBeInstanceOf(
            DbUpdateConcurrencyError,
        );
        expect(await storedParent(db, 'owned_profiles')).toBe('p1');
        await db.dispose();
    });

    it('allows a tracked new principal and dependent graph in one save', async () => {
        const db = await open();
        const parent = Object.assign(new OwnedParent(), {
            id: 'p3', tenantId: 't1',
        });
        const child = Object.assign(new OwnedChild(), {
            id: 'c2', tenantId: 't1', parentId: '', parent,
        });
        db.parents.add(parent);
        db.children.add(child);

        await expect(db.saveChanges()).resolves.toBe(2);
        expect(child.parentId).toBe('p3');
        expect(await db.children.where(row => row.id.eq('c2')).count()).toBe(1);
        await db.dispose();
    });

    it('allows a generated tenant-owned principal and dependent graph', async () => {
        const db = GeneratedTenantRelationshipContext.create();
        await db.database.connection.query({
            text: db.database.createScript(), values: [],
        });
        const parent = new GeneratedOwnedParent();
        const child = Object.assign(new GeneratedOwnedChild(), {
            id: 'c1', parent,
        });
        db.children.add(child);
        db.parents.add(parent);

        await expect(db.saveChanges()).resolves.toBe(2);
        expect(parent.id).toBe(1);
        expect(parent.tenantId).toBe('t1');
        expect(child.parentId).toBe(1);
        expect(child.tenantId).toBe('t1');
        await db.dispose();
    });

    it('resolves a generated placeholder only through the final tracked graph', async () => {
        const db = GeneratedTenantRelationshipContext.create();
        await db.database.connection.query({
            text: db.database.createScript(), values: [],
        });
        const parent = new GeneratedOwnedParent();
        const child = Object.assign(new GeneratedOwnedChild(), {
            id: 'c1', parentId: 0,
        });
        db.children.add(child);
        db.parents.add(parent);

        await expect(db.saveChanges()).resolves.toBe(2);
        expect(child.parent).toBe(parent);
        expect(child.parentId).toBe(parent.id);
        await db.dispose();
    });

    it('allows explicit cross-tenant relationship writes', async () => {
        const db = await open(true);
        const child = await db.children.where(row =>
            row.id.eq('c1').and(row.tenantId.eq('t1'))).single();
        child.parentId = 'p2';

        await expect(db.saveChanges()).resolves.toBe(1);
        expect(await storedParent(db)).toBe('p2');
        await db.dispose();
    });
});
