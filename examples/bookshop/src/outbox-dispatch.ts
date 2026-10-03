import type { BookshopStore } from './bookshop-store';
import { readOrderPlacedEvent, type OrderPlacedEvent } from './delivery-contract';

/** Publish one bounded batch. Receivers must deduplicate event IDs durably. */
export async function dispatchPending(
    store: BookshopStore,
    send: (event: OrderPlacedEvent) => Promise<void>,
    limit = 32,
): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 256) {
        throw new RangeError('Delivery batch size must be an integer from 1 to 256.');
    }
    const queue = store.context('delivery-queue', 'publisher');
    let delivered = 0;
    try {
        const batch = await queue.outbox.where(row => row.delivered.eq(0))
            .where(row => row.type.eq('Bookshop.OrderPlaced.v1'))
            .orderBy(row => row.id.asc()).take(limit).asNoTracking().toArray();
        for (const row of batch) {
            await send(readOrderPlacedEvent(row.payload));
            await queue.outbox.where(item => item.id.eq(row.id))
                .where(item => item.delivered.eq(0)).executeUpdate({ delivered: 1 });
            delivered += 1;
        }
        return delivered;
    } finally {
        await queue.dispose();
    }
}
