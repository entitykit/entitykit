import type { DbContextOptionsBuilder, ModelBuilder } from '../../packages/core/src';
import { DbContext, TenantOwnershipError } from '../../packages/core/src';
import { mySqlProviderServices } from '../../packages/mysql/src';
import { postgresProviderServices } from '../../packages/postgres/src';
import { requireDefined } from '../support/require-defined';

class TenantItem {
    public id = '';
    public tenantId = '';
    public name = '';
}

abstract class TenantUpsertContext extends DbContext {
    public items = this.set(TenantItem);

    protected override configure(options: DbContextOptionsBuilder): void {
        this.configureProvider(options);
        options.useTenantScope(() => 'tenant-1');
    }

    protected abstract configureProvider(options: DbContextOptionsBuilder): void;

    protected override model(model: ModelBuilder): void {
        model.entity(TenantItem, entity => {
            entity.toTable('tenant_guard_upsert_items');
            entity.hasKey(row => row.id);
            entity.tenantKey(row => row.tenantId);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
        });
    }
}

class PostgresTenantUpsertContext extends TenantUpsertContext {
    protected override configureProvider(options: DbContextOptionsBuilder): void {
        options.useProvider(
            postgresProviderServices,
            requireDefined(process.env.DATABASE_URL),
        );
    }
}

class MySqlTenantUpsertContext extends TenantUpsertContext {
    protected override configureProvider(options: DbContextOptionsBuilder): void {
        options.useProvider(
            mySqlProviderServices,
            requireDefined(process.env.MYSQL_URL ?? process.env.MYSQL_DATABASE_URL),
        );
    }
}

interface ProviderRuntime {
    readonly create: () => TenantUpsertContext;
    readonly placeholder: (index: number) => string;
    readonly dropSuffix: string;
    readonly provider: 'postgres' | 'mysql';
}

function defineOwnershipTest(runtime: ProviderRuntime): void {
    let db: TenantUpsertContext;

    beforeEach(async () => {
        db = runtime.create();
        await db.database.connection.query({
            text: `drop table if exists tenant_guard_upsert_items${runtime.dropSuffix}`,
            values: [],
        });
        await db.database.connection.query({
            text: db.database.createScript(),
            values: [],
        });
        await db.database.connection.query({
            text: 'insert into tenant_guard_upsert_items (id, tenant_id, name) ' +
                `values (${runtime.placeholder(1)}, ${runtime.placeholder(2)}, ` +
                `${runtime.placeholder(3)})`,
            values: ['shared', 'tenant-2', 'tenant two'],
        });
    });

    afterEach(async () => {
        await db.database.connection.query({
            text: `drop table if exists tenant_guard_upsert_items${runtime.dropSuffix}`,
            values: [],
        });
        await db.dispose();
    });

    it('does not update a conflicting row owned by another tenant', async () => {
        const incoming = Object.assign(new TenantItem(), {
            id: 'shared',
            name: 'hijacked',
        });
        const write = db.items.executeUpsert([incoming], {
            updateProperties: ['name'],
        });

        if (runtime.provider === 'postgres') {
            await expect(write).rejects.toBeInstanceOf(TenantOwnershipError);
        } else {
            await expect(write).rejects.toThrow(
                /cannot safely tenant-scope upsert.*tenantId.*primary-key conflict target/s,
            );
        }

        const stored = await db.database.connection.query<{
            tenant_id: string;
            name: string;
        }>({
            text: 'select tenant_id, name from tenant_guard_upsert_items ' +
                `where id = ${runtime.placeholder(1)}`,
            values: ['shared'],
        });
        expect(stored.rows).toEqual([{
            tenant_id: 'tenant-2',
            name: 'tenant two',
        }]);
    });
}

const postgresEnabled = process.env.RUN_POSTGRES_TESTS === 'true' &&
    Boolean(process.env.DATABASE_URL);
(postgresEnabled ? describe : describe.skip)(
    'Postgres tenant-owned upsert',
    () => {
        defineOwnershipTest({
            create: () => PostgresTenantUpsertContext.create(),
            placeholder: index => `$${String(index)}`,
            dropSuffix: ' cascade',
            provider: 'postgres',
        });
    },
);

const mysqlEnabled = process.env.RUN_MYSQL_TESTS === 'true' &&
    Boolean(process.env.MYSQL_URL ?? process.env.MYSQL_DATABASE_URL);
(mysqlEnabled ? describe : describe.skip)(
    'MySQL tenant-owned upsert',
    () => {
        defineOwnershipTest({
            create: () => MySqlTenantUpsertContext.create(),
            placeholder: () => '?',
            dropSuffix: '',
            provider: 'mysql',
        });
    },
);
