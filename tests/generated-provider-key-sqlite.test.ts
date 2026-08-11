import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, valueConverter } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';
import type { EntityEntry } from '../src/tracking/entity-entry';
import { temporaryGeneratedProperty } from '../src/tracking/temporary-generated-identity';
import { internalEntityEntry } from './support/public-api-internals';

let generatedHydrated = false;
let generatedConversions = 0;
let temporaryConversions = 0;
let driftTemporaryValues = false;

const driftingGeneratedKey = valueConverter<number, number>({
    toProvider: value => {
        if (!generatedHydrated && value === 0 && driftTemporaryValues) {
            temporaryConversions += 1;
            if (temporaryConversions === 1) return 0;
            if (temporaryConversions === 2) return 91;
            return 92;
        }
        if (!generatedHydrated || value !== 1) return value;
        generatedConversions += 1;
        return generatedConversions === 1 ? 1 : 0;
    },
    fromProvider: value => {
        if (value === 1 && !generatedHydrated) {
            generatedHydrated = true;
            generatedConversions = 0;
        }
        return value;
    },
});

function resetGeneratedConverter(driftTemporary = false): void {
    generatedHydrated = false;
    generatedConversions = 0;
    temporaryConversions = 0;
    driftTemporaryValues = driftTemporary;
}

class GeneratedProviderParent {
    public id = 0;
    public name = '';
    public children: GeneratedProviderChild[] = [];
}

class GeneratedProviderChild {
    public id = '';
    public parentId = 0;
    public parent!: GeneratedProviderParent;
}

class GeneratedProviderGraphContext extends DbContext {
    public parents = this.set(GeneratedProviderParent);
    public children = this.set(GeneratedProviderChild);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(GeneratedProviderParent, entity => {
            entity.toTable('generated_provider_parents');
            entity.hasKey(parent => parent.id);
            entity.property(parent => parent.id).hasColumnType('integer')
                .hasConversion(driftingGeneratedKey).isRequired()
                .useSqliteRowId();
            entity.property(parent => parent.name).hasColumnType('text')
                .isRequired();
        });
        model.entity(GeneratedProviderChild, entity => {
            entity.toTable('generated_provider_children');
            entity.hasKey(child => child.id);
            entity.property(child => child.id).hasColumnType('text').isRequired();
            entity.property(child => child.parentId).hasColumnName('parent_id')
                .hasColumnType('integer').isRequired();
            entity.hasOne(GeneratedProviderParent, child => child.parent)
                .withMany(parent => parent.children)
                .hasForeignKey(child => child.parentId);
        });
    }
}

class GeneratedProviderPost {
    public id = 0;
    public title = '';
    public tags: GeneratedProviderTag[] = [];
}

class GeneratedProviderTag {
    public id = '';
    public posts: GeneratedProviderPost[] = [];
}

class GeneratedProviderManyToManyContext extends DbContext {
    public posts = this.set(GeneratedProviderPost);
    public tags = this.set(GeneratedProviderTag);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(GeneratedProviderPost, entity => {
            entity.toTable('generated_provider_posts');
            entity.hasKey(post => post.id);
            entity.property(post => post.id).hasColumnType('integer')
                .hasConversion(driftingGeneratedKey).isRequired()
                .useSqliteRowId();
            entity.property(post => post.title).hasColumnType('text').isRequired();
            entity.hasManyToMany(GeneratedProviderTag, post => post.tags)
                .withMany(tag => tag.posts)
                .usingJoinTable('generated_provider_post_tags', join => {
                    join.sourceForeignKey('post_id');
                    join.targetForeignKey('tag_id');
                });
        });
        model.entity(GeneratedProviderTag, entity => {
            entity.toTable('generated_provider_tags');
            entity.hasKey(tag => tag.id);
            entity.property(tag => tag.id).hasColumnType('text').isRequired();
        });
    }
}

describe('generated provider key facts', () => {
    it('persists a dependent under the exact generated principal key', async () => {
        resetGeneratedConverter();
        const db = GeneratedProviderGraphContext.create();
        await db.database.connection.query({
            text: db.database.createScript(),
            values: [],
        });
        await db.database.connection.query({
            text: `insert into generated_provider_parents (id, name)
                values (?, ?)`,
            values: [0, 'existing-zero'],
        });
        const parent = Object.assign(new GeneratedProviderParent(), {
            name: 'new-parent',
        });
        const child = Object.assign(new GeneratedProviderChild(), {
            id: 'child',
            parent,
        });
        parent.children = [child];
        db.parents.add(parent);
        db.children.add(child);

        await expect(db.saveChanges()).resolves.toBe(2);

        expect(parent.id).toBe(1);
        expect(child.parentId).toBe(1);
        expect(db.entry(parent)?.originalValues.id).toBe(1);
        const stored = await db.database.connection.query<{
            parent_id: number;
        }>({
            text: 'select parent_id from generated_provider_children',
            values: [],
        });
        expect(stored.rows).toEqual([{ parent_id: 1 }]);
        await db.dispose();
    });

    it('matches dependent placeholders against the initially bound generated key', async () => {
        resetGeneratedConverter(true);
        const db = GeneratedProviderGraphContext.create();
        await db.database.connection.query({
            text: db.database.createScript(),
            values: [],
        });
        await db.database.connection.query({
            text: `insert into generated_provider_parents (id, name)
                values (?, ?)`,
            values: [0, 'existing-zero'],
        });
        const parent = Object.assign(new GeneratedProviderParent(), {
            name: 'new-parent',
        });
        const child = Object.assign(new GeneratedProviderChild(), {
            id: 'child',
            parent,
        });
        parent.children = [child];
        const parentEntry = db.parents.add(parent);
        db.children.add(child);

        const trackedParent = internalEntityEntry(parentEntry) as unknown as
            EntityEntry<object>;
        expect(temporaryGeneratedProperty(trackedParent, 'id')?.providerValue)
            .toBe(trackedParent.originalBoundValues.id);

        await expect(db.saveChanges()).resolves.toBe(2);

        expect(parent.id).toBe(1);
        expect(child.parentId).toBe(1);
        const stored = await db.database.connection.query<{
            parent_id: number;
        }>({
            text: 'select parent_id from generated_provider_children',
            values: [],
        });
        expect(stored.rows).toEqual([{ parent_id: 1 }]);
        await db.dispose();
    });

    it('links a many-to-many row with the exact generated endpoint key', async () => {
        resetGeneratedConverter();
        const db = GeneratedProviderManyToManyContext.create();
        await db.database.connection.query({
            text: db.database.createScript(),
            values: [],
        });
        await db.database.connection.query({
            text: `insert into generated_provider_posts (id, title)
                values (?, ?)`,
            values: [0, 'existing-zero'],
        });
        await db.database.connection.query({
            text: 'insert into generated_provider_tags (id) values (?)',
            values: ['tag'],
        });
        const post = Object.assign(new GeneratedProviderPost(), {
            title: 'new-post',
        });
        const tag = Object.assign(new GeneratedProviderTag(), { id: 'tag' });
        db.posts.add(post);
        db.tags.attach(tag);
        db.link(post, item => item.tags, tag);

        await expect(db.saveChanges()).resolves.toBe(1);

        expect(post.id).toBe(1);
        const stored = await db.database.connection.query<{
            post_id: number;
            tag_id: string;
        }>({
            text: `select post_id, tag_id
                from generated_provider_post_tags`,
            values: [],
        });
        expect(stored.rows).toEqual([{ post_id: 1, tag_id: 'tag' }]);
        await db.dispose();
    });
});
