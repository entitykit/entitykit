import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, lazy, valueConverter } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';
import type { EntityEntry as InternalEntityEntry } from '../src/tracking/entity-entry';
import { requireDefined } from './support/require-defined';
import {
    internalChangeTracker,
    internalEntityEntry,
} from './support/public-api-internals';

let providerFacts: string[] = [];
let providerFallback = 'one';
let providerConversions = 0;

const driftingIdentity = valueConverter<string, string>({
    toProvider: () => {
        providerConversions += 1;
        return providerFacts.shift() ?? providerFallback;
    },
    fromProvider: () => 'logical',
});

class BoundNavigationParent {
    public id = 'logical';
    public name = '';
    public children: BoundNavigationChild[] = [];
    public tags: BoundNavigationTag[] = [];
}

class BoundNavigationChild {
    public id = '';
    public parentId = 'logical';
    public parent?: BoundNavigationParent;
}

class BoundNavigationTag {
    public id = '';
    public parents: BoundNavigationParent[] = [];
}

class BoundNavigationContext extends DbContext {
    public parents = this.set(BoundNavigationParent);
    public children = this.set(BoundNavigationChild);
    public tags = this.set(BoundNavigationTag);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:')
            .useLazyLoading({ maxPerContext: 10 });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(BoundNavigationParent, entity => {
            entity.toTable('bound_navigation_parents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text')
                .hasConversion(driftingIdentity).isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
            entity.hasManyToMany(BoundNavigationTag, row => row.tags)
                .withMany(tag => tag.parents)
                .usingJoinTable('bound_navigation_parent_tags', join => {
                    join.sourceForeignKey('parent_id');
                    join.targetForeignKey('tag_id');
                });
        });
        model.entity(BoundNavigationChild, entity => {
            entity.toTable('bound_navigation_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('text').hasConversion(driftingIdentity)
                .isRequired();
            entity.hasOne(BoundNavigationParent, row => row.parent)
                .withMany(parent => parent.children)
                .hasForeignKey(row => row.parentId);
        });
        model.entity(BoundNavigationTag, entity => {
            entity.toTable('bound_navigation_tags');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
        });
    }
}

async function openBoundNavigation(): Promise<BoundNavigationContext> {
    providerFallback = 'one';
    providerFacts = [];
    const db = BoundNavigationContext.create();
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    for (const statement of [
        {
            text: `insert into bound_navigation_parents (id, name)
                values (?, ?), (?, ?)`,
            values: ['one', 'parent-one', 'two', 'parent-two'],
        },
        {
            text: `insert into bound_navigation_children (id, parent_id)
                values (?, ?), (?, ?)`,
            values: ['child-one', 'one', 'child-two', 'two'],
        },
        {
            text: 'insert into bound_navigation_tags (id) values (?), (?)',
            values: ['tag-one', 'tag-two'],
        },
        {
            text: `insert into bound_navigation_parent_tags
                (parent_id, tag_id) values (?, ?), (?, ?)`,
            values: ['one', 'tag-one', 'two', 'tag-two'],
        },
    ]) {
        await db.database.connection.query(statement);
    }
    return db;
}

function driftDuringLoad(): void {
    providerFacts = ['one', 'two'];
    providerConversions = 0;
}

class AlternateParent {
    public id = '';
    public region = '';
    public code = 'logical';
    public children: AlternateChild[] = [];
}

class AlternateChild {
    public id = '';
    public parentRegion = '';
    public parentCode = 'logical';
    public parent?: AlternateParent;
}

class AlternateNavigationContext extends DbContext {
    public parents = this.set(AlternateParent);
    public children = this.set(AlternateChild);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(AlternateParent, entity => {
            entity.toTable('alternate_parents');
            entity.hasKey(row => row.id);
            entity.hasAlternateKey(row => [row.region, row.code]);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.region).hasColumnType('text').isRequired();
            entity.property(row => row.code).hasColumnType('text')
                .hasConversion(driftingIdentity).isRequired();
        });
        model.entity(AlternateChild, entity => {
            entity.toTable('alternate_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.parentRegion)
                .hasColumnName('parent_region').hasColumnType('text').isRequired();
            entity.property(row => row.parentCode)
                .hasColumnName('parent_code').hasColumnType('text')
                .hasConversion(driftingIdentity).isRequired();
            entity.hasOne(AlternateParent, row => row.parent)
                .withMany(parent => parent.children)
                .hasForeignKey(row => [row.parentRegion, row.parentCode])
                .hasPrincipalKey(row => [row.region, row.code]);
        });
    }
}

async function openAlternateNavigation(): Promise<AlternateNavigationContext> {
    providerFallback = 'one';
    providerFacts = [];
    const db = AlternateNavigationContext.create();
    await db.database.connection.query({
        text: db.database.createScript(), values: [],
    });
    await db.database.connection.query({
        text: `insert into alternate_parents (id, region, code)
            values (?, ?, ?), (?, ?, ?)`,
        values: [
            'parent-one', 'north', 'one',
            'parent-two', 'north', 'two',
        ],
    });
    await db.database.connection.query({
        text: `insert into alternate_children
            (id, parent_region, parent_code)
            values (?, ?, ?), (?, ?, ?)`,
        values: [
            'child-one', 'north', 'one',
            'child-two', 'north', 'two',
        ],
    });
    return db;
}

describe('navigation bound provider facts', () => {
    it('loads a collection from the tracked provider key', async () => {
        const db = await openBoundNavigation();
        const parent = Object.assign(new BoundNavigationParent(), {
            name: 'attached',
        });
        db.parents.attach(parent);
        driftDuringLoad();

        const children = await requireDefined(db.entry(parent))
            .collection(row => row.children).load();

        expect(children.map(row => row.id)).toEqual(['child-one']);
        expect(providerConversions).toBe(1);
        await db.dispose();
    });

    it('loads a reference from the tracked provider foreign key', async () => {
        const db = await openBoundNavigation();
        const child = Object.assign(new BoundNavigationChild(), {
            id: 'attached-child',
        });
        db.children.attach(child);
        driftDuringLoad();

        const parent = await requireDefined(db.entry(child))
            .reference(row => row.parent).load();

        expect(parent?.name).toBe('parent-one');
        expect(providerConversions).toBe(0);
        await db.dispose();
    });

    it('reuses the tracked provider foreign key during lazy loading', async () => {
        const db = await openBoundNavigation();
        const child = Object.assign(new BoundNavigationChild(), {
            id: 'lazy-child',
        });
        db.children.attach(child);
        driftDuringLoad();

        const parent = await lazy(child).parent;
        const cached = await lazy(child).parent;

        expect(parent.name).toBe('parent-one');
        expect(cached).toBe(parent);
        expect(providerConversions).toBe(0);
        await db.dispose();
    });

    it('loads many-to-many rows from the tracked provider key', async () => {
        const db = await openBoundNavigation();
        const parent = new BoundNavigationParent();
        db.parents.attach(parent);
        driftDuringLoad();

        const tags = await requireDefined(db.entry(parent))
            .collection(row => row.tags).load();

        expect(tags.map(row => row.id)).toEqual(['tag-one']);
        expect(providerConversions).toBe(1);
        await db.dispose();
    });

    it('loads a converted composite alternate-key reference once', async () => {
        const db = await openAlternateNavigation();
        const child = Object.assign(new AlternateChild(), {
            id: 'attached-child', parentRegion: 'north',
        });
        db.children.attach(child);
        driftDuringLoad();

        const parent = await requireDefined(db.entry(child))
            .reference(row => row.parent).load();

        expect(parent?.id).toBe('parent-one');
        expect(providerConversions).toBe(0);
        await db.dispose();
    });

    it('loads a collection through a converted composite alternate key once', async () => {
        const db = await openAlternateNavigation();
        const parent = Object.assign(new AlternateParent(), {
            id: 'attached-parent', region: 'north',
        });
        db.parents.attach(parent);
        driftDuringLoad();

        const children = await requireDefined(db.entry(parent))
            .collection(row => row.children).load();

        expect(children.map(row => row.id)).toEqual(['child-one']);
        expect(providerConversions).toBe(1);
        await db.dispose();
    });

    it('detects an unchanged relationship from one captured provider tuple', () => {
        const db = BoundNavigationContext.create();
        providerFallback = 'one';
        providerFacts = [];
        const parent = Object.assign(new BoundNavigationParent(), {
            name: 'parent',
        });
        const child = Object.assign(new BoundNavigationChild(), {
            id: 'child', parent,
        });
        parent.children = [child];
        db.parents.attach(parent);
        db.children.attach(child);
        providerFacts = Array.from(
            { length: 20 }, (_, index) => index % 2 === 0 ? 'one' : 'two',
        );
        providerConversions = 0;

        internalChangeTracker(db.changeTracker).detectSaveRelationships();

        expect(child.parent).toBe(parent);
        expect(parent.children).toEqual([child]);
        expect(providerConversions).toBe(0);
    });

    it('reuses a tracked principal tuple while fixing a navigation change', async () => {
        const db = await openBoundNavigation();
        const firstChild = requireDefined(await db.children.find('child-one'));
        const firstParent = requireDefined(
            await requireDefined(db.entry(firstChild))
                .reference(row => row.parent).load(),
        );
        const secondChild = requireDefined(await db.children.find('child-two'));
        const secondParent = requireDefined(
            await requireDefined(db.entry(secondChild))
                .reference(row => row.parent).load(),
        );
        firstChild.parent = secondParent;
        providerFacts = ['two'];
        providerConversions = 0;
        const detected = internalEntityEntry(
            requireDefined(db.entry(firstChild)),
        ) as unknown as InternalEntityEntry<object>;

        internalChangeTracker(db.changeTracker)
            .detectSaveRelationships([detected]);

        expect(firstChild.parent).toBe(secondParent);
        expect(firstParent.children).toEqual([]);
        expect(secondParent.children).toEqual([secondChild, firstChild]);
        expect(providerConversions).toBe(1);
        await db.dispose();
    });
});
