import { createHash } from 'node:crypto';
import { UniqueConstraintError } from '@entitykit/core';
import type { BookshopStore } from './bookshop-store';
import { IdempotencyMismatchError } from './checkout-contract';
import { readOrderPlacedEvent, type OrderPlacedEvent } from './delivery-contract';
import { DeliveryReceipt, Shipment } from './shop-entities';

/** A receiver owns its own durable deduplication and database side effect. */
export async function fulfillOrder(store: BookshopStore, incoming: OrderPlacedEvent): Promise<void> {
    const event = readOrderPlacedEvent(JSON.stringify(incoming));
    const fingerprint = createHash('sha256').update(JSON.stringify(event)).digest('hex');
    await store.source.executeWithRetry(async () => {
        const db = store.context(event.tenantId, 'fulfillment-worker');
        try {
            await db.transaction(async tx => {
                const existing = await tx.deliveries.find(event.tenantId, event.eventId);
                if (existing) {
                    if (existing.fingerprint !== fingerprint) throw new IdempotencyMismatchError();
                    return;
                }
                const order = await tx.orders.findOrThrow(event.tenantId, event.orderId);
                if (order.sku !== event.sku || order.quantity !== event.quantity) {
                    throw new Error('The fulfillment event does not match its order.');
                }
                tx.shipments.add(Object.assign(new Shipment(), { tenantId: event.tenantId,
                    orderId: event.orderId, sku: event.sku, quantity: event.quantity }));
                tx.deliveries.add(Object.assign(new DeliveryReceipt(), { tenantId: event.tenantId,
                    eventId: event.eventId, fingerprint }));
                await tx.saveChanges();
            });
        } catch (error) {
            if (!(error instanceof UniqueConstraintError)) throw error;
            const replay = store.context(event.tenantId, 'fulfillment-worker');
            try {
                const existing = await replay.deliveries.find(event.tenantId, event.eventId);
                if (!existing) throw error;
                if (existing.fingerprint !== fingerprint) throw new IdempotencyMismatchError();
            } finally {
                await replay.dispose();
            }
        } finally {
            await db.dispose();
        }
    });
}
