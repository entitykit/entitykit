import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext, DbUpdateConcurrencyError } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { requireDefined } from './support/require-defined';

class TenantPost {
    public id = '';
    public tenantId = '';
    public tags: TenantTag[] = [];
}

class TenantTag {
    public id = '';
    public tenantId = '';
    public posts: TenantPost[] = [];
}

class TenantRelationshipContext extends DbContext {
    public posts = this.set(TenantPost);
    public tags = this.set(TenantTag);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:')
            .useTenantScope(() => 'tenant-1');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(TenantPost, entity => {
            entity.toTable('tenant_posts');
            entity.hasKey(row => row.id);
            entity.tenantKey(row => row.tenantId);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').isRequired();
            entity.hasManyToMany(TenantTag, row => row.tags)
                .withMany(tag => tag.posts)
                .usingJoinTable('tenant_post_tags', join => {
                    join.sourceForeignKey('post_id');
                    join.targetForeignKey('tag_id');
                });
        });
        model.entity(TenantTag, entity => {
            entity.toTable('tenant_tags');
            entity.hasKey(row => row.id);
            entity.tenantKey(row => row.tenantId);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').isRequired();
        });
    }
}

async function open(linked: boolean): Promise<TenantRelationshipContext> {
    const db = TenantRelationshipContext.create();
    await db.database.connection.query({
        text: db.database.createScript(),
        values: [],
    });
    await db.database.connection.query({
        text: 'insert into tenant_posts (id, tenant_id) values (?, ?)',
        values: ['post-1', 'tenant-1'],
    });
    await db.database.connection.query({
        text: 'insert into tenant_tags (id, tenant_id) values (?, ?)',
        values: ['tag-1', 'tenant-1'],
    });
    if (linked) {
        await db.database.connection.query({
            text: 'insert into tenant_post_tags (post_id, tag_id) values (?, ?)',
            values: ['post-1', 'tag-1'],
        });
    }
    return db;
}

async function retag(db: TenantRelationshipContext, tenantId: string): Promise<void> {
    await db.database.connection.query({
        text: 'update tenant_tags set tenant_id = ? where id = ?',
        values: [tenantId, 'tag-1'],
    });
}

async function joinCount(db: TenantRelationshipContext): Promise<number> {
    const result = await db.database.connection.query<{ count: number }>({
        text: 'select count(*) as count from tenant_post_tags',
        values: [],
    });
    return result.rows[0]?.count ?? 0;
}

describe('tenant-owned many-to-many writes', () => {
    it('rejects link after an endpoint is retagged in the database', async () => {
        const db = await open(false);
        const post = requireDefined(await db.posts.find('post-1'));
        const tag = requireDefined(await db.tags.find('tag-1'));
        await retag(db, 'tenant-2');
        db.link(post, row => row.tags, tag);

        await expect(db.saveChanges())
            .rejects.toBeInstanceOf(DbUpdateConcurrencyError);
        expect(await joinCount(db)).toBe(0);

        await retag(db, 'tenant-1');
        await expect(db.saveChanges()).resolves.toBe(0);
        expect(await joinCount(db)).toBe(1);
        await db.dispose();
    });

    it('rejects unlink after an endpoint is retagged in the database', async () => {
        const db = await open(true);
        const post = await db.posts.include(row => row.tags).single();
        const tag = requireDefined(post.tags[0]);
        await retag(db, 'tenant-2');
        db.unlink(post, row => row.tags, tag);

        await expect(db.saveChanges())
            .rejects.toBeInstanceOf(DbUpdateConcurrencyError);
        expect(await joinCount(db)).toBe(1);

        await retag(db, 'tenant-1');
        await expect(db.saveChanges()).resolves.toBe(0);
        expect(await joinCount(db)).toBe(0);
        await db.dispose();
    });
});
