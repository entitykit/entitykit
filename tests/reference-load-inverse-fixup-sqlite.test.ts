import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, EntityState, lazy } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';
import { requireDefined } from './support/require-defined';

class LoadParent {
    public id = '';
    public children: LoadChild[] = [];
}

class LoadChild {
    public id = '';
    public parentId: string | null = null;
    public parent: LoadParent | null = null;
}

class LoadAccount {
    public id = '';
    public profile: LoadProfile | null = null;
}

class LoadProfile {
    public id = '';
    public accountId = '';
    public account: LoadAccount | null = null;
}

class ReferenceFixupContext extends DbContext {
    public parents = this.set(LoadParent);
    public children = this.set(LoadChild);
    public accounts = this.set(LoadAccount);
    public profiles = this.set(LoadProfile);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:')
            .useLazyLoading({ maxPerContext: 10 });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(LoadParent, entity => {
            entity.toTable('load_parents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
        });
        model.entity(LoadChild, entity => {
            entity.toTable('load_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('text').isOptional();
            entity.hasOne(LoadParent, row => row.parent)
                .withMany(parent => parent.children)
                .hasForeignKey(row => row.parentId);
        });
        model.entity(LoadAccount, entity => {
            entity.toTable('load_accounts');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
        });
        model.entity(LoadProfile, entity => {
            entity.toTable('load_profiles');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.accountId).hasColumnName('account_id')
                .hasColumnType('text').isRequired();
            entity.hasOne(LoadAccount, row => row.account)
                .withOne(account => account.profile)
                .hasForeignKey(row => row.accountId);
        });
    }
}

async function openContext(): Promise<ReferenceFixupContext> {
    const db = ReferenceFixupContext.create();
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    await db.database.connection.query({
        text: 'insert into load_parents (id) values (?), (?)',
        values: ['p1', 'p2'],
    });
    await db.database.connection.query({
        text: 'insert into load_children (id, parent_id) values (?, ?)',
        values: ['c', 'p1'],
    });
    await db.database.connection.query({
        text: 'insert into load_accounts (id) values (?), (?)',
        values: ['a1', 'a2'],
    });
    await db.database.connection.query({
        text: 'insert into load_profiles (id, account_id) values (?, ?)',
        values: ['profile', 'a1'],
    });
    return db;
}

async function trackedManyToOne(db: ReferenceFixupContext): Promise<{
    parent1: LoadParent;
    parent2: LoadParent;
    child: LoadChild;
}> {
    const parent1 = requireDefined(await db.parents.find('p1'));
    const parent2 = requireDefined(await db.parents.find('p2'));
    const children = await requireDefined(db.entry(parent1))
        .collection(row => row.children).load();
    return { parent1, parent2, child: requireDefined(children[0]) };
}

async function storedParentId(
    db: ReferenceFixupContext,
): Promise<string | null> {
    const result = await db.database.connection.query<{
        parent_id: string | null;
    }>({
        text: 'select parent_id from load_children where id = ?', values: ['c'],
    });
    return requireDefined(result.rows[0]).parent_id;
}

async function storedAccountId(
    db: ReferenceFixupContext,
): Promise<string> {
    const result = await db.database.connection.query<{ account_id: string }>({
        text: 'select account_id from load_profiles where id = ?',
        values: ['profile'],
    });
    return requireDefined(result.rows[0]).account_id;
}

describe('reference load inverse fix-up', () => {
    it('populates an unloaded inverse during initial reference loading', async () => {
        const db = await openContext();
        const parent = requireDefined(await db.parents.find('p1'));
        const child = requireDefined(await db.children.find('c'));
        expect(parent.children).toEqual([]);
        expect(db.entry(parent)?.isNavigationLoaded('children')).toBe(false);

        const loaded = await requireDefined(db.entry(child))
            .reference(row => row.parent).load();

        expect(loaded).toBe(parent);
        expect(child.parent).toBe(parent);
        expect(parent.children).toEqual([child]);
        expect(db.entry(parent)?.isNavigationLoaded('children')).toBe(false);
        await db.dispose();
    });

    it('moves a dependent between inverse collections during explicit loading', async () => {
        const db = await openContext();
        const { parent1, parent2, child } = await trackedManyToOne(db);
        expect(db.entry(parent1)?.isNavigationLoaded('children')).toBe(true);
        expect(db.entry(parent2)?.isNavigationLoaded('children')).toBe(false);
        child.parentId = 'p2';

        const loaded = await requireDefined(db.entry(child))
            .reference(row => row.parent).load();

        expect(loaded).toBe(parent2);
        expect(child.parent).toBe(parent2);
        expect(parent1.children).toEqual([]);
        expect(parent2.children).toEqual([child]);
        expect(db.entry(parent2)?.isNavigationLoaded('children')).toBe(false);
        await expect(db.saveChanges()).resolves.toBe(1);
        expect(await storedParentId(db)).toBe('p2');
        expect(db.changeTracker.entries().every(
            entry => entry.state === EntityState.Unchanged,
        )).toBe(true);
        expect(parent1.children).toEqual([]);
        expect(parent2.children).toEqual([child]);
        await db.dispose();
    });

    it('moves a dependent between inverse collections during lazy loading', async () => {
        const db = await openContext();
        const { parent1, parent2, child } = await trackedManyToOne(db);
        child.parentId = 'p2';

        expect(await lazy(child).parent).toBe(parent2);

        expect(parent1.children).toEqual([]);
        expect(parent2.children).toEqual([child]);
        expect(db.entry(parent2)?.isNavigationLoaded('children')).toBe(false);
        await expect(db.saveChanges()).resolves.toBe(1);
        expect(await storedParentId(db)).toBe('p2');
        expect(db.changeTracker.entries().every(
            entry => entry.state === EntityState.Unchanged,
        )).toBe(true);
        expect(parent1.children).toEqual([]);
        expect(parent2.children).toEqual([child]);
        await db.dispose();
    });

    it('removes a dependent from its old inverse when no principal is found', async () => {
        const db = await openContext();
        const { parent1, child } = await trackedManyToOne(db);
        child.parentId = 'missing';

        const loaded = await requireDefined(db.entry(child))
            .reference(row => row.parent).load();

        expect(loaded).toBeNull();
        expect(child.parent).toBeNull();
        expect(parent1.children).toEqual([]);
        expect(db.entry(child)?.isNavigationLoaded('parent')).toBe(true);
        await db.dispose();
    });

    it('removes a dependent from its old inverse when its key is null', async () => {
        const db = await openContext();
        const { parent1, child } = await trackedManyToOne(db);
        child.parentId = null;

        const loaded = await requireDefined(db.entry(child))
            .reference(row => row.parent).load();

        expect(loaded).toBeNull();
        expect(child.parent).toBeNull();
        expect(parent1.children).toEqual([]);
        expect(db.entry(child)?.isNavigationLoaded('parent')).toBe(true);
        await db.dispose();
    });

    it('clears the old one-to-one inverse when loading a new principal', async () => {
        const db = await openContext();
        const account2 = requireDefined(await db.accounts.find('a2'));
        const profile = requireDefined(await db.profiles.find('profile'));
        const account1 = requireDefined(await requireDefined(db.entry(profile))
            .reference(row => row.account).load());
        expect(account1.profile).toBe(profile);
        profile.accountId = 'a2';

        const loaded = await requireDefined(db.entry(profile))
            .reference(row => row.account).load();

        expect(loaded).toBe(account2);
        expect(profile.account).toBe(account2);
        expect(account1.profile).toBeNull();
        expect(account2.profile).toBe(profile);
        await expect(db.saveChanges()).resolves.toBe(1);
        expect(await storedAccountId(db)).toBe('a2');
        expect(db.changeTracker.entries().every(
            entry => entry.state === EntityState.Unchanged,
        )).toBe(true);
        expect(account1.profile).toBeNull();
        expect(account2.profile).toBe(profile);
        await db.dispose();
    });

    it('reloads a reference without churning the inverse collection', async () => {
        const db = await openContext();
        await db.database.connection.query({
            text: 'insert into load_children (id, parent_id) values (?, ?), (?, ?)',
            values: ['c2', 'p1', 'c3', 'p1'],
        });
        const { parent1, child } = await trackedManyToOne(db);

        const loaded = await requireDefined(db.entry(child))
            .reference(row => row.parent).load();

        expect(loaded).toBe(parent1);
        expect(parent1.children.map(row => row.id)).toEqual(['c', 'c2', 'c3']);
        await db.dispose();
    });

    it('skips the inverse baseline of a principal that left the context', async () => {
        const db = await openContext();
        const { parent1, parent2, child } = await trackedManyToOne(db);
        db.changeTracker.detach(parent1);
        child.parentId = 'p2';

        const loaded = await requireDefined(db.entry(child))
            .reference(row => row.parent).load();

        expect(loaded).toBe(parent2);
        expect(parent1.children).toEqual([child]);
        await db.dispose();
    });

    it('captures the new inverse baseline for later change detection', async () => {
        const db = await openContext();
        await db.database.connection.query({
            text: 'insert into load_children (id, parent_id) values (?, ?)',
            values: ['c2', 'p2'],
        });
        const parent2 = requireDefined(await db.parents.find('p2'));
        const child = requireDefined(await db.children.find('c2'));
        await requireDefined(db.entry(child))
            .reference(row => row.parent).load();

        parent2.children = [];
        db.changeTracker.detectChanges();

        expect(child.parent).toBeNull();
        expect(child.parentId).toBeNull();
        await db.dispose();
    });

    it('reloads and then clears a one-to-one reference', async () => {
        const db = await openContext();
        const profile = requireDefined(await db.profiles.find('profile'));
        const entry = requireDefined(db.entry(profile));
        const account = requireDefined(
            await entry.reference(row => row.account).load(),
        );

        expect(await entry.reference(row => row.account).load()).toBe(account);
        expect(account.profile).toBe(profile);
        profile.accountId = 'missing';
        expect(await entry.reference(row => row.account).load()).toBeNull();
        expect(profile.account).toBeNull();
        expect(account.profile).toBeNull();
        await db.dispose();
    });

    it('refuses a second dependent for a tracked one-to-one principal', async () => {
        const db = await openContext();
        await db.database.connection.query({
            text: 'insert into load_profiles (id, account_id) values (?, ?)',
            values: ['profile2', 'a2'],
        });
        const profile = requireDefined(await db.profiles.find('profile'));
        const other = requireDefined(await db.profiles.find('profile2'));
        const account = requireDefined(await requireDefined(db.entry(profile))
            .reference(row => row.account).load());
        other.accountId = 'a1';

        await expect(requireDefined(db.entry(other))
            .reference(row => row.account).load()).rejects.toThrow(
            'One-to-one relationship \'profile\' matched more than one dependent entity.',
        );
        expect(account.profile).toBe(profile);
        await db.dispose();
    });

    it('keeps relationship history when loaded-state inspection invalidates a reference', async () => {
        const db = await openContext();
        const { parent1, parent2, child } = await trackedManyToOne(db);
        child.parentId = 'p2';
        child.parent = parent2;

        expect(db.entry(child)?.isNavigationLoaded('parent')).toBe(false);
        db.changeTracker.detectChanges();

        expect(child.parent).toBe(parent2);
        expect(parent1.children).toEqual([]);
        expect(parent2.children).toEqual([child]);
        await db.dispose();
    });
});
