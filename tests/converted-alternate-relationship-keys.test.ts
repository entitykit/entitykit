import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, valueConverter } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';

class PrincipalKey {
    readonly #value: string;

    constructor(value: string) {
        this.#value = value;
    }

    public get value(): string {
        return this.#value;
    }
}

class DependentKey {
    readonly #value: string;

    constructor(value: string) {
        this.#value = value;
    }

    public get value(): string {
        return this.#value;
    }
}

const principalTenant = valueConverter<PrincipalKey, string>({
    toProvider: value => value.value.trim().toLowerCase(),
    fromProvider: value => new PrincipalKey(value),
});
const principalCode = valueConverter<PrincipalKey, string>({
    toProvider: value => value.value.trim().toUpperCase(),
    fromProvider: value => new PrincipalKey(value),
});
const dependentTenant = valueConverter<DependentKey, string>({
    toProvider: value => value.value.trim().toLowerCase(),
    fromProvider: value => new DependentKey(value),
});
const dependentCode = valueConverter<DependentKey, string>({
    toProvider: value => value.value.trim().toUpperCase(),
    fromProvider: value => new DependentKey(value),
});

class ConvertedAccount {
    public id = '';
    public tenantId!: PrincipalKey;
    public code!: PrincipalKey;
    public name = '';
    public orders: ConvertedOrder[] = [];
}

class ConvertedOrder {
    public id = '';
    public tenantId!: DependentKey;
    public accountCode!: DependentKey;
    public account?: ConvertedAccount;
}

class ConvertedAlternateKeyContext extends DbContext {
    public accounts = this.set(ConvertedAccount);
    public orders = this.set(ConvertedOrder);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(ConvertedAccount, entity => {
            entity.toTable('converted_accounts');
            entity.hasKey(account => account.id);
            entity.hasAlternateKey(account => [account.tenantId, account.code]);
            entity.property(account => account.id).hasColumnType('text').isRequired();
            entity.property(account => account.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').hasConversion(principalTenant).isRequired();
            entity.property(account => account.code).hasColumnType('text')
                .hasConversion(principalCode).isRequired();
            entity.property(account => account.name).hasColumnType('text').isRequired();
        });
        model.entity(ConvertedOrder, entity => {
            entity.toTable('converted_orders');
            entity.hasKey(order => order.id);
            entity.property(order => order.id).hasColumnType('text').isRequired();
            entity.property(order => order.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').hasConversion(dependentTenant).isRequired();
            entity.property(order => order.accountCode).hasColumnName('account_code')
                .hasColumnType('text').hasConversion(dependentCode).isRequired();
            entity.hasOne(ConvertedAccount, order => order.account)
                .withMany(account => account.orders)
                .hasForeignKey(order => [order.tenantId, order.accountCode])
                .hasPrincipalKey(account => [account.tenantId, account.code]);
        });
    }
}

describe('converted alternate relationship keys', () => {
    it('normalizes composite keys and translates both model types', async () => {
        const db = ConvertedAlternateKeyContext.create();
        await db.database.connection.query({
            text: db.database.createScript(),
            values: [],
        });
        const account = Object.assign(new ConvertedAccount(), {
            id: 'account-1',
            tenantId: new PrincipalKey(' ACME '),
            code: new PrincipalKey(' north '),
            name: 'North',
        });
        const order = Object.assign(new ConvertedOrder(), {
            id: 'order-1',
            tenantId: new DependentKey('acme'),
            accountCode: new DependentKey('NORTH'),
        });
        db.orders.add(order);
        db.accounts.add(account);

        expect(db.getSavePlan().map(entry => entry.entityName)).toEqual([
            'ConvertedAccount',
            'ConvertedOrder',
        ]);
        await expect(db.saveChanges()).resolves.toBe(2);
        db.changeTracker.clear();

        const loadedOrder = await db.orders.include(item => item.account).single();
        expect(loadedOrder.account?.id).toBe('account-1');
        db.changeTracker.clear();
        const loadedAccount = await db.accounts
            .include(item => item.orders)
            .single();
        expect(loadedAccount.orders.map(item => item.id)).toEqual(['order-1']);
        const movedOrder = loadedAccount.orders[0];

        const replacement = Object.assign(new ConvertedAccount(), {
            id: 'account-2',
            tenantId: new PrincipalKey('Acme'),
            code: new PrincipalKey(' south '),
            name: 'South',
        });
        db.accounts.add(replacement);
        await db.saveChanges();
        movedOrder.account = replacement;

        await expect(db.saveChanges()).resolves.toBe(1);
        expect(movedOrder.tenantId).toBeInstanceOf(DependentKey);
        expect(movedOrder.accountCode.value).toBe('SOUTH');
        expect(loadedAccount.orders).toEqual([]);
        expect(replacement.orders).toEqual([movedOrder]);
        const stored = await db.database.connection.query<{
            tenant_id: string;
            account_code: string;
        }>({
            text: 'select tenant_id, account_code from converted_orders',
            values: [],
        });
        expect(stored.rows).toEqual([{
            tenant_id: 'acme',
            account_code: 'SOUTH',
        }]);
        await db.dispose();
    });
});
