import type { BookshopStore } from './bookshop-store';
import { Inventory } from './shop-entities';

const tables = ['bookshop_outbox', 'bookshop_audit', 'bookshop_receipts', 'bookshop_orders', 'bookshop_inventory'];

/** Destructive setup is restricted to the example's test tables in qualify.ts. */
export async function resetShop(store: BookshopStore, available = 5): Promise<void> {
    const db = store.context('north-shop', 'system');
    try {
        for (const table of tables) {
            const name = store.source.dialect.quoteIdentifier(table);
            await db.database.executeStatement({ text: `drop table if exists ${name}`, values: [] });
        }
        await db.database.ensureCreated();
        db.inventory.add(Object.assign(new Inventory(), { tenantId: 'north-shop', sku: 'typescript-book', available }));
        await db.saveChanges();
    } finally {
        await db.dispose();
    }
    const other = store.context('south-shop', 'system');
    try {
        other.inventory.add(Object.assign(new Inventory(), { tenantId: 'south-shop', sku: 'typescript-book', available: 7 }));
        await other.saveChanges();
    } finally {
        await other.dispose();
    }
}

export async function shopSnapshot(store: BookshopStore, tenantId = 'north-shop'): Promise<object> {
    const db = store.context(tenantId, 'operator');
    try {
        const inventory = await db.inventory.findOrThrow(tenantId, 'typescript-book');
        return { available: inventory.available, version: inventory.version,
            orders: await db.orders.count(), audit: await db.audit.count(),
            receipts: await db.receipts.count(), outbox: await db.outbox.count() };
    } finally {
        await db.dispose();
    }
}
