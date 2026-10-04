import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { openBookshop, type BookshopStore, type ShopProvider } from './bookshop-store';
import { readCheckoutResult } from './checkout-contract';
import { fulfillOrder } from './fulfillment';
import { dispatchPending } from './outbox-dispatch';
import { resetShop, shopSnapshot } from './qualification-fixture';

export async function qualifyRecovery(store: BookshopStore, provider: ShopProvider, target: string): Promise<void> {
    await resetShop(store);
    const before = await shopSnapshot(store);
    assert.equal(await crashChild(provider, target, 'before-commit'), 'persisted-before-commit');
    assert.deepEqual(await shopSnapshot(store), before);
    console.log('BOOKSHOP_PROCESS_CRASH_ROLLBACK_OK');

    const original = readCheckoutResult(await crashChild(provider, target, 'after-commit'));
    const replay = readCheckoutResult(await crashChild(provider, target, 'after-commit'));
    assert.deepEqual(replay, original);
    assert.deepEqual(await shopSnapshot(store), { available: 3, version: 2, orders: 1, audit: 1, receipts: 1, outbox: 1 });
    console.log('BOOKSHOP_PROCESS_RESTART_RECEIPT_REPLAY_OK');

    assert.equal(await crashChild(provider, target, 'after-delivery'), 'delivered-before-ack');
    const restarted = openBookshop(provider, target);
    try {
        await assertDelivery(restarted, 0);
        assert.equal(await dispatchPending(restarted, async event => fulfillOrder(restarted, event)), 1);
        await assertDelivery(restarted, 1);
        assert.equal(await dispatchPending(restarted, async event => fulfillOrder(restarted, event)), 0);
        assert.deepEqual(await shopSnapshot(restarted), { available: 3, version: 2, orders: 1, audit: 1, receipts: 1, outbox: 1 });
    } finally {
        await restarted.dispose();
    }
    console.log('BOOKSHOP_DELIVERY_CRASH_DEDUPLICATION_ACK_OK');
}

async function assertDelivery(store: BookshopStore, delivered: number): Promise<void> {
    const db = store.context('north-shop', 'auditor');
    try {
        assert.equal(await db.shipments.count(), 1);
        assert.equal(await db.deliveries.count(), 1);
        assert.equal((await db.outbox.first()).delivered, delivered);
    } finally {
        await db.dispose();
    }
    const other = store.context('south-shop', 'auditor');
    try {
        assert.equal(await other.shipments.count(), 0);
        assert.equal(await other.deliveries.count(), 0);
    } finally {
        await other.dispose();
    }
}

async function crashChild(provider: ShopProvider, target: string, mode: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath,
            ['--unhandled-rejections=strict', join(__dirname, 'recovery-child.js'), provider, mode],
            { env: { ...process.env, BOOKSHOP_DATABASE_URL: target }, stdio: ['ignore', 'pipe', 'ignore'] });
        let output = '';
        child.stdout.on('data', (chunk: Buffer) => {
            output += chunk.toString('utf8');
        });
        const timeout = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`Bookshop ${mode} child exceeded 15 seconds.`));
        }, 15_000);
        child.on('error', error => {
            clearTimeout(timeout);
            reject(error);
        });
        child.on('close', code => {
            clearTimeout(timeout);
            if (code !== 73) reject(new Error(`Bookshop ${mode} child did not reach its crash checkpoint.`));
            else resolve(output);
        });
    });
}
