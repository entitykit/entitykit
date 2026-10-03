import type { EntityKitDataSource } from '@entitykit/core';
import { createMySqlDataSource } from '@entitykit/mysql';
import { createPostgresDataSource } from '@entitykit/postgres';
import { createSqliteDataSource } from '@entitykit/sqlite';
import { assertIdentifier } from './checkout-contract';
import { ShopContext } from './shop-context';

export type ShopProvider = 'sqlite' | 'postgres' | 'mysql';

export class BookshopStore {
    constructor(public readonly source: EntityKitDataSource<object>) {}

    public context(tenantId: string, actorId: string): ShopContext {
        assertIdentifier(tenantId);
        assertIdentifier(actorId);
        return this.source.createContext(ShopContext, tenantId, actorId);
    }

    public async dispose(): Promise<void> {
        await this.source.dispose();
    }
}

export function openBookshop(provider: ShopProvider, target: string): BookshopStore {
    const options = { retry: { maxAttempts: 3, initialDelayMs: 10, maxDelayMs: 50 } };
    switch (provider) {
        case 'sqlite': return new BookshopStore(createSqliteDataSource({ filename: target, journalMode: 'WAL' }, options));
        case 'postgres': return new BookshopStore(createPostgresDataSource({ connectionString: target, pool: { max: 4 } }, options));
        case 'mysql': return new BookshopStore(createMySqlDataSource({ connectionString: target, pool: { max: 4 }, timezone: 'Z' }, options));
    }
}
