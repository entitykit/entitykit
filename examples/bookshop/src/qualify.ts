import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openBookshop, type ShopProvider } from './bookshop-store';
import { qualifyCheckout } from './qualification-checkout';

async function qualify(): Promise<void> {
    const provider = process.argv[2];
    if (provider !== 'sqlite' && provider !== 'postgres' && provider !== 'mysql') {
        throw new Error('Choose sqlite, postgres, or mysql.');
    }
    const directory = provider === 'sqlite' ? mkdtempSync(join(tmpdir(), 'entitykit-bookshop-')) : undefined;
    const target = testTarget(provider, directory);
    const store = openBookshop(provider, target);
    try {
        await qualifyCheckout(store);
        console.log(`BOOKSHOP_QUALIFICATION_OK provider=${provider}`);
    } finally {
        await store.dispose();
        if (directory) rmSync(directory, { recursive: true, force: true });
    }
}

function testTarget(provider: ShopProvider, directory?: string): string {
    if (directory) return join(directory, 'bookshop.db');
    const target = process.env.BOOKSHOP_DATABASE_URL;
    if (!target || !/test|qualification|hardening/u.test(new URL(target).pathname)) {
        throw new Error(`${provider} requires BOOKSHOP_DATABASE_URL naming a test, qualification, or hardening database.`);
    }
    return target;
}

qualify().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Bookshop qualification failed.');
    process.exitCode = 1;
});
