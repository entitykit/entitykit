import { openBookshop } from './bookshop-store';
import { checkout, placeOrder } from './checkout';
import { fulfillOrder } from './fulfillment';
import { dispatchPending } from './outbox-dispatch';

// Intentionally terminates without finally/disposal to qualify real crash recovery.
async function run(): Promise<void> {
    const provider = process.argv[2];
    const mode = process.argv[3];
    const target = process.env.BOOKSHOP_DATABASE_URL;
    if (provider !== 'sqlite' && provider !== 'postgres' && provider !== 'mysql' || !target) {
        throw new Error('Missing recovery child configuration.');
    }
    const store = openBookshop(provider, target);
    const command = { requestId: 'restart-1', sku: 'typescript-book', quantity: 2 };
    if (mode === 'before-commit') {
        const db = store.context('north-shop', 'bookseller');
        await db.transaction(async tx => {
            await placeOrder(tx, command);
            await crash('persisted-before-commit');
        });
    } else if (mode === 'after-commit') {
        const response = await checkout(store, 'north-shop', 'bookseller', command);
        await crash(JSON.stringify(response));
    } else if (mode === 'after-delivery') {
        await dispatchPending(store, async event => {
            await fulfillOrder(store, event);
            await crash('delivered-before-ack');
        });
    } else {
        throw new Error('Unknown recovery child mode.');
    }
}

async function crash(message: string): Promise<never> {
    return new Promise(() => {
        process.stdout.write(message, () => {
            process.exit(73);
        });
    });
}

run().catch(() => {
    console.error('BOOKSHOP_RECOVERY_CHILD_FAILED');
    process.exitCode = 1;
});
