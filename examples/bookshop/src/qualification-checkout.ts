import assert from 'node:assert/strict';
import { DbUpdateConcurrencyError } from '@entitykit/core';
import type { BookshopStore } from './bookshop-store';
import { checkout, placeOrder } from './checkout';
import { IdempotencyMismatchError } from './checkout-contract';
import { resetShop, shopSnapshot } from './qualification-fixture';

const command = { requestId: 'checkout-1', sku: 'typescript-book', quantity: 2 };

export async function qualifyCheckout(store: BookshopStore): Promise<void> {
    await resetShop(store);
    const response = await checkout(store, 'north-shop', 'bookseller', command);
    assert.equal(response.version, 1);
    assert.deepEqual(await checkout(store, 'north-shop', 'bookseller', command), response);
    assert.deepEqual(await shopSnapshot(store), { available: 3, version: 2, orders: 1, audit: 1, receipts: 1, outbox: 1 });
    await assert.rejects(checkout(store, 'north-shop', 'bookseller', { ...command, quantity: 1 }), IdempotencyMismatchError);
    await assert.rejects(checkout(store, 'north-shop', 'other-actor', command), IdempotencyMismatchError);
    await assert.rejects(checkout(store, 'north-shop', 'bookseller', { ...command, quantity: 0 }), RangeError);
    await assert.rejects(checkout(store, 'North-Shop', 'bookseller', command), TypeError);
    const db = store.context('north-shop', 'auditor');
    try {
        const order = await db.orders.findOrThrow('north-shop', response.orderId);
        assert.equal(order.createdBy, 'bookseller');
        assert.ok(order.createdAt instanceof Date);
        assert.equal((await db.audit.first()).actorId, 'bookseller');
        const event = await db.outbox.first();
        assert.equal(event.type, 'Bookshop.OrderPlaced.v1');
        const payload = JSON.parse(event.payload) as { tenantId: string; orderId: string; eventId: string };
        assert.equal(payload.tenantId, 'north-shop');
        assert.equal(payload.orderId, response.orderId);
        assert.equal(payload.eventId, `${response.orderId}.placed.1`);
        assert.equal(await db.orders.find('south-shop', response.orderId), null);
    } finally {
        await db.dispose();
    }
    await checkout(store, 'south-shop', 'bookseller', { ...command, quantity: 1 });
    assert.deepEqual(await shopSnapshot(store, 'south-shop'), { available: 6, version: 2, orders: 1, audit: 1, receipts: 1, outbox: 2 });
    console.log('BOOKSHOP_ATOMIC_CHECKOUT_REPLAY_TENANCY_OK');

    await resetShop(store);
    const before = await shopSnapshot(store);
    const rollback = store.context('north-shop', 'bookseller');
    try {
        await assert.rejects(rollback.transaction(async tx => {
            await placeOrder(tx, command);
            throw new Error('rollback after all five persistence writes');
        }), /rollback after all five persistence writes/u);
    } finally {
        await rollback.dispose();
    }
    assert.deepEqual(await shopSnapshot(store), before);
    await checkout(store, 'north-shop', 'bookseller', command);
    assert.deepEqual(await shopSnapshot(store), { available: 3, version: 2, orders: 1, audit: 1, receipts: 1, outbox: 1 });
    console.log('BOOKSHOP_ATOMIC_ROLLBACK_OK');

    await resetShop(store);
    const first = store.context('north-shop', 'first-writer');
    const second = store.context('north-shop', 'stale-writer');
    try {
        const winner = await first.inventory.findOrThrow('north-shop', 'typescript-book');
        const stale = await second.inventory.findOrThrow('north-shop', 'typescript-book');
        winner.available -= 1;
        stale.available -= 2;
        await first.saveChanges();
        await assert.rejects(second.saveChanges(), DbUpdateConcurrencyError);
    } finally {
        await second.dispose();
        await first.dispose();
    }
    assert.deepEqual(await shopSnapshot(store), { available: 4, version: 2, orders: 0, audit: 0, receipts: 0, outbox: 0 });
    console.log('BOOKSHOP_STALE_VERSION_REJECTED_OK');

    await resetShop(store);
    const duplicates = await Promise.all([
        checkout(store, 'north-shop', 'bookseller', command),
        checkout(store, 'north-shop', 'bookseller', command),
    ]);
    assert.deepEqual(duplicates[0], duplicates[1]);
    assert.deepEqual(await shopSnapshot(store), { available: 3, version: 2, orders: 1, audit: 1, receipts: 1, outbox: 1 });

    await resetShop(store, 1);
    const competing = await Promise.allSettled([
        checkout(store, 'north-shop', 'bookseller', { ...command, requestId: 'race-a', quantity: 1 }),
        checkout(store, 'north-shop', 'bookseller', { ...command, requestId: 'race-b', quantity: 1 }),
    ]);
    assert.equal(competing.filter(result => result.status === 'fulfilled').length, 1);
    assert.deepEqual(await shopSnapshot(store), { available: 0, version: 2, orders: 1, audit: 1, receipts: 1, outbox: 1 });
    console.log('BOOKSHOP_CONCURRENT_IDEMPOTENCY_STOCK_OK');
}
