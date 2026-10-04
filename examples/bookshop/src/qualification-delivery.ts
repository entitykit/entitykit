import assert from 'node:assert/strict';
import type { BookshopStore } from './bookshop-store';
import { checkout } from './checkout';
import { IdempotencyMismatchError } from './checkout-contract';
import { readOrderPlacedEvent } from './delivery-contract';
import { fulfillOrder } from './fulfillment';
import { dispatchPending } from './outbox-dispatch';
import { resetShop } from './qualification-fixture';

export async function qualifyDelivery(store: BookshopStore): Promise<void> {
    await resetShop(store);
    const command = { requestId: 'delivery-1', sku: 'typescript-book', quantity: 1 };
    await checkout(store, 'north-shop', 'bookseller', command);
    await checkout(store, 'north-shop', 'bookseller', { ...command, requestId: 'delivery-2' });
    const queue = store.context('north-shop', 'auditor');
    try {
        const event = readOrderPlacedEvent((await queue.outbox.orderBy(row => row.id.asc()).first()).payload);
        await assert.rejects(dispatchPending(store, async incoming => fulfillOrder(store, incoming), 0), RangeError);
        assert.equal(await dispatchPending(store, async incoming => fulfillOrder(store, incoming), 1), 1);
        assert.equal(await queue.shipments.count(), 1);
        assert.equal(await queue.deliveries.count(), 1);
        await assert.rejects(fulfillOrder(store, { ...event, quantity: 2 }), IdempotencyMismatchError);
        await assert.rejects(fulfillOrder(store, { ...event, eventId: 'forged-event' }), /invalid delivery identity/u);
        await assert.rejects(fulfillOrder(store, { ...event, tenantId: 'south-shop' }));
        assert.equal(await queue.shipments.count(), 1);
        assert.equal(await queue.deliveries.count(), 1);
        await Promise.all([
            dispatchPending(store, async incoming => fulfillOrder(store, incoming)),
            dispatchPending(store, async incoming => fulfillOrder(store, incoming)),
        ]);
        assert.equal(await queue.shipments.count(), 2);
        assert.equal(await queue.deliveries.count(), 2);
        assert.equal(await queue.outbox.where(row => row.delivered.eq(0)).count(), 0);
    } finally {
        await queue.dispose();
    }
    const other = store.context('south-shop', 'auditor');
    try {
        assert.equal(await other.shipments.count(), 0);
        assert.equal(await other.deliveries.count(), 0);
    } finally {
        await other.dispose();
    }
    console.log('BOOKSHOP_BOUNDED_DELIVERY_CONCURRENT_RECEIVERS_OK');
}
