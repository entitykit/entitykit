import path from 'node:path';
import { createManagedTempDirectory } from './support/managed-temp-directory';
import { defineQueryCacheProviderTests } from './support/query-cache-provider-contract';
describe('SQLite Bookshop compiled query cache', () => {
    defineQueryCacheProviderTests('sqlite', () => path.join(createManagedTempDirectory('entitykit-query-cache-'), 'books.sqlite'));
});
