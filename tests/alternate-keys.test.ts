import { ModelBuilder as ModelBuilderImplementation } from '../packages/core/src/model/model-builder';
import type { DbContextOptionsBuilder , ModelBuilder } from '../packages/core/src';
import { DbContext, lazy } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';
import {
    diffModelSnapshots,
    contextMigrations,
    MigrationSqlGenerator,
} from '../packages/core/src/migrations/api';
import { requireDefined } from './support/require-defined';

class Account {
    public id!: string;
    public tenantId!: string;
    public code!: string;
    public name!: string;
    public orders?: Order[];

    constructor(data?: Partial<Account>) {
        Object.assign(this, data);
    }
}

class Order {
    public id!: string;
    public tenantId!: string;
    public accountCode!: string;
    public account?: Account | null;

    constructor(data?: Partial<Order>) {
        Object.assign(this, data);
    }
}

class AlternateKeyContext extends DbContext {
    public accounts = this.set(Account);
    public orders = this.set(Order);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Account, entity => {
            entity.toTable('accounts');
            entity.hasKey(account => account.id);
            entity.property(account => account.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(account => account.tenantId).hasColumnName('tenant_id').hasColumnType('text').isRequired();
            entity.property(account => account.code).hasColumnName('code').hasColumnType('text').isRequired();
            entity.property(account => account.name).hasColumnName('name').hasColumnType('text').isRequired();
            entity.hasAlternateKey(account => [account.tenantId, account.code])
                .hasDatabaseName('ak_accounts_tenant_code');
        });

        model.entity(Order, entity => {
            entity.toTable('orders');
            entity.hasKey(order => order.id);
            entity.property(order => order.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(order => order.tenantId).hasColumnName('tenant_id').hasColumnType('text').isRequired();
            entity.property(order => order.accountCode).hasColumnName('account_code').hasColumnType('text').isRequired();
            entity.hasOne(Account, order => order.account)
                .withMany(account => account.orders)
                .hasForeignKey(order => [order.tenantId, order.accountCode])
                .hasPrincipalKey(account => [account.tenantId, account.code]);
        });
    }
}

class LazyAlternateKeyContext extends AlternateKeyContext {
    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
        options.useLazyLoading();
    }
}

async function createDb(): Promise<AlternateKeyContext> {
    const db = AlternateKeyContext.create();
    await db.database.connection.query({ text: db.database.createScript(), values: [] });
    return db;
}

async function seed(db: AlternateKeyContext): Promise<void> {
    db.accounts.add(new Account({
        id: 'account_pk_1',
        tenantId: 'tenant_1',
        code: 'acme',
        name: 'Acme',
    }));
    db.accounts.add(new Account({
        id: 'account_pk_2',
        tenantId: 'tenant_2',
        code: 'acme',
        name: 'Other Acme',
    }));
    db.orders.add(new Order({
        id: 'order_1',
        tenantId: 'tenant_1',
        accountCode: 'acme',
    }));
    await db.saveChanges();
    db.changeTracker.clear();
}

describe('alternate and principal keys', () => {
    it('generates uniqueness and a foreign key to the alternate tuple', () => {
        const db = AlternateKeyContext.create();
        const script = db.database.createScript();

        expect(script).toContain(
            'references "accounts" ("tenant_id", "code")',
        );
        expect(script).toContain(
            'constraint "ak_accounts_tenant_code" unique ("tenant_id", "code")',
        );
    });

    it('loads both relationship directions and relation filters by alternate key', async () => {
        const db = await createDb();
        await seed(db);

        const order = await db.orders
            .include(item => item.account)
            .single();
        expect(requireDefined(order.account).id).toBe('account_pk_1');

        db.changeTracker.clear();
        const account = await db.accounts
            .where(item => item.tenantId.eq('tenant_1'))
            .include(item => item.orders)
            .single();
        expect(requireDefined(account.orders).map(item => item.id))
            .toEqual(['order_1']);

        db.changeTracker.clear();
        const matched = await db.accounts
            .whereHas(item => item.orders, item => item.id.eq('order_1'))
            .toArray();
        expect(matched.map(item => item.id)).toEqual(['account_pk_1']);

        const matchedOrders = await db.orders
            .whereHas(item => item.account, item => item.tenantId.eq('tenant_1'))
            .toArray();
        expect(matchedOrders.map(item => item.id)).toEqual(['order_1']);
        await db.dispose();
    });

    it('supports filtered includes and explicit loading through alternate keys', async () => {
        const db = await createDb();
        await seed(db);

        const account = await db.accounts
            .where(item => item.tenantId.eq('tenant_1'))
            .include(item => item.orders.orderBy(order => order.id).take(1))
            .single();
        expect(account.orders?.map(order => order.id)).toEqual(['order_1']);

        db.changeTracker.clear();
        const order = await db.orders.single();
        const loaded = await requireDefined(db.entry(order))
            .reference(item => item.account)
            .load();
        expect(loaded?.id).toBe('account_pk_1');
        await db.dispose();
    });

    it('loads alternate-key references through opt-in lazy loading', async () => {
        const db = LazyAlternateKeyContext.create();
        await db.database.connection.query({
            text: db.database.createScript(),
            values: [],
        });
        await seed(db);

        const order = await db.orders.single();
        expect((await lazy(order).account).id).toBe('account_pk_1');
        await db.dispose();
    });

    it('synchronizes alternate foreign keys from a tracked principal navigation', async () => {
        const db = await createDb();
        const account = new Account({
            id: 'account_pk_1',
            tenantId: 'tenant_1',
            code: 'acme',
            name: 'Acme',
            orders: [],
        });
        const order = new Order({
            id: 'order_1',
            account,
        });
        db.accounts.add(account);
        db.orders.add(order);

        await expect(db.saveChanges()).resolves.toBe(2);

        expect(order.tenantId).toBe('tenant_1');
        expect(order.accountCode).toBe('acme');
        expect(account.orders).toEqual([order]);
        await db.dispose();
    });

    it('records alternate and principal key order in snapshots', () => {
        const snapshot = contextMigrations(AlternateKeyContext.create()).createModelSnapshot();
        const account = snapshot.entities.find(item => item.entityName === 'Account');
        const order = snapshot.entities.find(item => item.entityName === 'Order');

        expect(account?.alternateKeys).toEqual([{
            propertyNames: ['tenantId', 'code'],
            databaseName: 'ak_accounts_tenant_code',
        }]);
        expect(order?.relationships[0]?.principalKeyProperties)
            .toEqual(['tenantId', 'code']);
    });

    it('migrates the alternate key before its referencing foreign key', () => {
        const snapshot = contextMigrations(AlternateKeyContext.create()).createModelSnapshot();
        const diff = diffModelSnapshots(
            { formatVersion: 1, entities: [] },
            snapshot,
        );

        expect(diff.operations).toEqual(expect.arrayContaining([
            expect.objectContaining({
                kind: 'createIndex',
                name: 'ak_accounts_tenant_code',
                columns: ['tenant_id', 'code'],
                unique: true,
            }),
            expect.objectContaining({
                kind: 'addForeignKey',
                columns: ['tenant_id', 'account_code'],
                principalColumns: ['tenant_id', 'code'],
            }),
        ]));
        const operationKinds = diff.operations.map(operation => operation.kind);
        expect(operationKinds.indexOf('createIndex'))
            .toBeLessThan(operationKinds.indexOf('addForeignKey'));

        const sql = new MigrationSqlGenerator().generateUpScript(
            diff.toMigration('20260731000100_AlternateKeys', 'AlternateKeys'),
        );
        expect(sql).toContain(
            'references "accounts" ("tenant_id", "code")',
        );

        const down = diffModelSnapshots(
            snapshot,
            { formatVersion: 1, entities: [] },
        );
        const downKinds = down.operations.map(operation => operation.kind);
        expect(downKinds.indexOf('dropForeignKey'))
            .toBeLessThan(downKinds.indexOf('dropIndex'));
    });

    it('preserves alternate-key references through a hinted column rename', () => {
        const from = contextMigrations(AlternateKeyContext.create()).createModelSnapshot();
        const to = structuredClone(from);
        const account = to.entities.find(entity =>
            entity.entityName === 'Account');
        const order = to.entities.find(entity => entity.entityName === 'Order');
        const code = account?.properties.find(property =>
            property.propertyName === 'code');
        if (!account || !order || !code) {
            throw new Error('Expected alternate-key model snapshot.');
        }
        (code as { propertyName: string; columnName: string }).propertyName =
            'accountCode';
        (code as { columnName: string }).columnName = 'account_code';
        (account.alternateKeys?.[0] as { propertyNames: string[] })
            .propertyNames = ['tenantId', 'accountCode'];
        (account.indexes[0] as unknown as { propertyNames: string[] })
            .propertyNames = ['tenantId', 'accountCode'];
        (order.relationships[0] as unknown as {
            principalKeyProperties: string[];
        })
            .principalKeyProperties = ['tenantId', 'accountCode'];

        const diff = diffModelSnapshots(from, to, {
            renameHints: {
                columns: [{
                    tableName: 'accounts',
                    from: 'code',
                    to: 'account_code',
                }],
            },
        });

        expect(diff.operations).toHaveLength(1);
        expect(diff.operations[0]).toMatchObject({
            kind: 'alterColumn',
            column: { oldName: 'code', name: 'account_code' },
        });
    });

    it('rejects changes to a tracked alternate key', () => {
        const db = AlternateKeyContext.create();
        const account = new Account({
            id: 'account_pk_1',
            tenantId: 'tenant_1',
            code: 'before',
            name: 'Acme',
        });
        db.accounts.attach(account);
        account.code = 'after';

        expect(() => db.getSavePlan()).toThrow(
            'Alternate key changes are not supported for entity \'Account\'',
        );
    });

    it('rejects a principal tuple that is not a declared key', () => {
        const model = new ModelBuilderImplementation();
        model.entity(Account, entity => {
            entity.toTable('accounts');
            entity.hasKey(account => account.id);
            entity.property(account => account.id).hasColumnType('text').isRequired();
            entity.property(account => account.code).hasColumnType('text').isRequired();
        });
        model.entity(Order, entity => {
            entity.toTable('orders');
            entity.hasKey(order => order.id);
            entity.property(order => order.id).hasColumnType('text').isRequired();
            entity.property(order => order.accountCode).hasColumnType('text').isRequired();
            entity.hasOne(Account, order => order.account)
                .hasForeignKey(order => order.accountCode)
                .hasPrincipalKey(account => account.code);
        });

        expect(() => model.build()).toThrow(
            'is not the primary key or a declared alternate key',
        );
    });
});
