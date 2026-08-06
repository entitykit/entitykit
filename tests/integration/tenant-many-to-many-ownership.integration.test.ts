import type { DbContextOptionsBuilder, ModelBuilder } from '../../src';
import { DbContext, DbUpdateConcurrencyError } from '../../src';
import { mySqlProviderServices } from '../../src/providers/mysql';
import { postgresProviderServices } from '../../src/providers/postgres';
import { requireDefined } from '../support/require-defined';

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

abstract class TenantRelationshipContext extends DbContext {
    public posts = this.set(TenantPost);
    public tags = this.set(TenantTag);

    protected override configure(options: DbContextOptionsBuilder): void {
        this.configureProvider(options);
        options.useTenantScope(() => 'tenant-1');
    }

    protected abstract configureProvider(options: DbContextOptionsBuilder): void;

    protected override model(model: ModelBuilder): void {
        model.entity(TenantPost, entity => {
            entity.toTable('tenant_guard_posts');
            entity.hasKey(row => row.id);
            entity.tenantKey(row => row.tenantId);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').isRequired();
            entity.hasManyToMany(TenantTag, row => row.tags)
                .withMany(tag => tag.posts)
                .usingJoinTable('tenant_guard_post_tags', join => {
                    join.sourceForeignKey('post_id');
                    join.targetForeignKey('tag_id');
                });
        });
        model.entity(TenantTag, entity => {
            entity.toTable('tenant_guard_tags');
            entity.hasKey(row => row.id);
            entity.tenantKey(row => row.tenantId);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').isRequired();
        });
    }
}

class PostgresTenantRelationshipContext extends TenantRelationshipContext {
    protected override configureProvider(options: DbContextOptionsBuilder): void {
        options.useProvider(
            postgresProviderServices,
            requireDefined(process.env.DATABASE_URL),
        );
    }
}

class MySqlTenantRelationshipContext extends TenantRelationshipContext {
    protected override configureProvider(options: DbContextOptionsBuilder): void {
        options.useProvider(
            mySqlProviderServices,
            requireDefined(process.env.MYSQL_URL ?? process.env.MYSQL_DATABASE_URL),
        );
    }
}

interface ProviderRuntime {
    readonly create: () => TenantRelationshipContext;
    readonly placeholder: (index: number) => string;
    readonly dropSuffix: string;
}

function defineOwnershipTests(runtime: ProviderRuntime): void {
    let db: TenantRelationshipContext;

    const query = async (text: string, values: unknown[] = []): Promise<void> => {
        await db.database.connection.query({ text, values });
    };
    const dropAll = async (): Promise<void> => {
        for (const table of [
            'tenant_guard_post_tags',
            'tenant_guard_posts',
            'tenant_guard_tags',
        ]) {
            await query(`drop table if exists ${table}${runtime.dropSuffix}`);
        }
    };
    const retag = async (tenantId: string): Promise<void> => {
        await query(
            `update tenant_guard_tags set tenant_id = ${runtime.placeholder(1)} ` +
            `where id = ${runtime.placeholder(2)}`,
            [tenantId, 'tag-1'],
        );
    };
    const joinCount = async (): Promise<number> => {
        const result = await db.database.connection.query<{
            count: number | string;
        }>({
            text: 'select count(*) as count from tenant_guard_post_tags',
            values: [],
        });
        return Number(result.rows[0]?.count ?? 0);
    };

    beforeEach(async () => {
        db = runtime.create();
        await dropAll();
        await query(db.database.createScript());
        await query(
            'insert into tenant_guard_posts (id, tenant_id) values ' +
            `(${runtime.placeholder(1)}, ${runtime.placeholder(2)})`,
            ['post-1', 'tenant-1'],
        );
        await query(
            'insert into tenant_guard_tags (id, tenant_id) values ' +
            `(${runtime.placeholder(1)}, ${runtime.placeholder(2)})`,
            ['tag-1', 'tenant-1'],
        );
    });

    afterEach(async () => {
        await dropAll();
        await db.dispose();
    });

    it('rejects link after an endpoint is retagged in the database', async () => {
        const post = requireDefined(await db.posts.find('post-1'));
        const tag = requireDefined(await db.tags.find('tag-1'));
        await retag('tenant-2');
        db.link(post, row => row.tags, tag);

        await expect(db.saveChanges())
            .rejects.toBeInstanceOf(DbUpdateConcurrencyError);
        expect(await joinCount()).toBe(0);

        await retag('tenant-1');
        await expect(db.saveChanges()).resolves.toBe(0);
        expect(await joinCount()).toBe(1);
    });

    it('rejects unlink after an endpoint is retagged in the database', async () => {
        await query(
            'insert into tenant_guard_post_tags (post_id, tag_id) values ' +
            `(${runtime.placeholder(1)}, ${runtime.placeholder(2)})`,
            ['post-1', 'tag-1'],
        );
        const post = await db.posts.include(row => row.tags).single();
        const tag = requireDefined(post.tags[0]);
        await retag('tenant-2');
        db.unlink(post, row => row.tags, tag);

        await expect(db.saveChanges())
            .rejects.toBeInstanceOf(DbUpdateConcurrencyError);
        expect(await joinCount()).toBe(1);

        await retag('tenant-1');
        await expect(db.saveChanges()).resolves.toBe(0);
        expect(await joinCount()).toBe(0);
    });
}

const postgresEnabled = process.env.RUN_POSTGRES_TESTS === 'true' &&
    Boolean(process.env.DATABASE_URL);
(postgresEnabled ? describe : describe.skip)(
    'Postgres tenant-owned many-to-many writes',
    () => {
        defineOwnershipTests({
            create: () => PostgresTenantRelationshipContext.create(),
            placeholder: index => `$${String(index)}`,
            dropSuffix: ' cascade',
        });
    },
);

const mysqlEnabled = process.env.RUN_MYSQL_TESTS === 'true' &&
    Boolean(process.env.MYSQL_URL ?? process.env.MYSQL_DATABASE_URL);
(mysqlEnabled ? describe : describe.skip)(
    'MySQL tenant-owned many-to-many writes',
    () => {
        defineOwnershipTests({
            create: () => MySqlTenantRelationshipContext.create(),
            placeholder: () => '?',
            dropSuffix: '',
        });
    },
);
