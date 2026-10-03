import { createHash, randomUUID } from 'node:crypto';
import { DbUpdateConcurrencyError, UniqueConstraintError } from '@entitykit/core';
import type { BookshopStore } from './bookshop-store';
import { IdempotencyMismatchError, readCheckoutResult, validateCommand,
    type CheckoutCommand, type CheckoutResult } from './checkout-contract';
import { AuditRecord, CommandReceipt, Order } from './shop-entities';
import type { ShopContext } from './shop-context';

/** Establish tenant and actor authority before calling this application boundary. */
export async function checkout(
    store: BookshopStore, tenantId: string, actorId: string, command: CheckoutCommand,
): Promise<CheckoutResult> {
    validateCommand(command);
    return store.source.executeWithRetry(async () => {
        for (let attempt = 1; ; attempt += 1) {
            const db = store.context(tenantId, actorId);
            try {
                return await db.transaction(async tx => placeOrder(tx, command));
            } catch (error) {
                if (error instanceof UniqueConstraintError) {
                    const replay = store.context(tenantId, actorId);
                    try {
                        const receipt = await replay.receipts.find(tenantId, command.requestId);
                        if (receipt) return replayReceipt(replay, receipt, command);
                    } finally {
                        await replay.dispose();
                    }
                }
                if (!(error instanceof DbUpdateConcurrencyError) || attempt >= 3) throw error;
            } finally {
                await db.dispose();
            }
        }
    });
}

/** Compose checkout with other database work in the caller's explicit transaction. */
export async function placeOrder(db: ShopContext, command: CheckoutCommand): Promise<CheckoutResult> {
    validateCommand(command);
    if (!db.database.connection.isInTransaction) throw new Error('Checkout requires an explicit transaction.');
    const receipt = await db.receipts.find(db.tenantId, command.requestId);
    if (receipt) return replayReceipt(db, receipt, command);
    const inventory = await db.inventory.findOrThrow(db.tenantId, command.sku);
    if (inventory.available < command.quantity) throw new Error('Insufficient stock.');

    const order = Object.assign(new Order(), {
        id: randomUUID(), tenantId: db.tenantId, sku: command.sku, quantity: command.quantity,
    });
    const response: CheckoutResult = { tenantId: db.tenantId, orderId: order.id,
        sku: order.sku, quantity: order.quantity, version: order.version };
    order.events.push({ type: 'Bookshop.OrderPlaced.v1', payload: {
        ...response, eventId: `${order.id}.placed.1`,
    } });
    inventory.available -= command.quantity;
    db.orders.add(order);
    db.audit.add(Object.assign(new AuditRecord(), { id: randomUUID(), tenantId: db.tenantId,
        orderId: order.id, actorId: db.actorId, action: 'order.placed' }));
    db.receipts.add(Object.assign(new CommandReceipt(), { tenantId: db.tenantId,
        requestId: command.requestId, fingerprint: fingerprint(db, command),
        orderId: order.id, response: JSON.stringify(response) }));
    await db.saveChanges();
    return response;
}

function fingerprint(db: ShopContext, command: CheckoutCommand): string {
    return createHash('sha256').update(JSON.stringify([
        'Bookshop.PlaceOrder.v1', db.tenantId, db.actorId, command.sku, command.quantity,
    ])).digest('hex');
}

function replayReceipt(db: ShopContext, receipt: CommandReceipt, command: CheckoutCommand): CheckoutResult {
    if (receipt.fingerprint !== fingerprint(db, command)) throw new IdempotencyMismatchError();
    const response = readCheckoutResult(receipt.response);
    if (response.tenantId !== db.tenantId || response.orderId !== receipt.orderId
        || response.sku !== command.sku || response.quantity !== command.quantity) {
        throw new Error('The durable checkout receipt does not match its command.');
    }
    return response;
}
