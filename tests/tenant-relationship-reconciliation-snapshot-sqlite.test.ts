import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, EntityState } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';

class TenantAccount {
    public id = '';
    public tenantId = '';
    public code = '';
    public orders: TenantOrder[] = [];
}

class TenantOrder {
    private accountCodeFallback = '';
    private accountCodeReads: string[] = [];
    public id = '';
    public tenantId = '';
    public name = '';
    public account: TenantAccount | null = null;
    public accountCodeReadCount = 0;

    public get accountCode(): string {
        this.accountCodeReadCount += 1;
        return this.accountCodeReads.shift() ?? this.accountCodeFallback;
    }

    public set accountCode(value: string) {
        this.accountCodeFallback = value;
    }

    public returnAccountCodes(...values: string[]): void {
        this.accountCodeReads = [...values];
        this.accountCodeReadCount = 0;
    }
}

class TenantRelationshipSnapshotContext extends DbContext {
    public accounts = this.set(TenantAccount);
    public orders = this.set(TenantOrder);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:')
            .useTenantScope(() => 'tenant');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(TenantAccount, entity => {
            entity.toTable('tenant_snapshot_accounts');
            entity.hasKey(account => account.id);
            entity.hasAlternateKey(account => [account.tenantId, account.code]);
            entity.tenantKey(account => account.tenantId);
            entity.property(account => account.id).hasColumnType('text')
                .isRequired();
            entity.property(account => account.tenantId)
                .hasColumnName('tenant_id').hasColumnType('text').isRequired();
            entity.property(account => account.code).hasColumnType('text')
                .isRequired();
        });
        model.entity(TenantOrder, entity => {
            entity.toTable('tenant_snapshot_orders');
            entity.hasKey(order => order.id);
            entity.tenantKey(order => order.tenantId);
            entity.property(order => order.id).hasColumnType('text').isRequired();
            entity.property(order => order.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').isRequired();
            entity.property(order => order.accountCode)
                .hasColumnName('account_code').hasColumnType('text').isRequired();
            entity.property(order => order.name).hasColumnType('text').isRequired();
            entity.hasOne(TenantAccount, order => order.account)
                .withMany(account => account.orders)
                .hasForeignKey(order => [order.tenantId, order.accountCode])
                .hasPrincipalKey(account => [account.tenantId, account.code]);
        });
    }
}

describe('tenant relationship reconciliation snapshots', () => {
    it('does not reread a composite FK when tenant policy made no write', async () => {
        const db = TenantRelationshipSnapshotContext.create();
        await db.database.connection.query({
            text: db.database.createScript(),
            values: [],
        });
        await db.database.connection.query({
            text: `insert into tenant_snapshot_accounts
                (id, tenant_id, code) values (?, ?, ?), (?, ?, ?)`,
            values: [
                'account-parent', 'tenant', 'parent',
                'account-wrong', 'tenant', 'wrong',
            ],
        });
        await db.database.connection.query({
            text: `insert into tenant_snapshot_orders
                (id, tenant_id, account_code, name) values (?, ?, ?, ?)`,
            values: ['order', 'tenant', 'parent', 'before'],
        });
        const account = Object.assign(new TenantAccount(), {
            id: 'account-parent', tenantId: 'tenant', code: 'parent',
        });
        const order = Object.assign(new TenantOrder(), {
            id: 'order', tenantId: 'tenant', accountCode: 'parent',
            name: 'before', account,
        });
        account.orders = [order];
        db.accounts.attach(account);
        db.orders.attach(order);
        order.name = 'after';
        order.returnAccountCodes('parent', 'parent', 'parent', 'wrong');

        await expect(db.saveChanges()).resolves.toBe(1);

        const stored = await db.database.connection.query<{
            account_code: string;
        }>({
            text: `select account_code from tenant_snapshot_orders
                where id = ?`,
            values: ['order'],
        });
        expect(stored.rows).toEqual([{ account_code: 'parent' }]);
        expect(db.entry(order)?.originalValues.accountCode).toBe('parent');
        expect(db.entry(order)?.state).toBe(EntityState.Unchanged);
        expect(order.accountCodeReadCount).toBe(5);
        await db.dispose();
    });
});
