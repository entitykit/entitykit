import path from 'node:path';
import { createManagedTempDirectory } from './support/managed-temp-directory';
import { defineMigrationTableOrderProviderTests } from './support/migration-table-order-provider-contract';

describe('SQLite generated migration dependency ordering', () => {
    defineMigrationTableOrderProviderTests('sqlite', () => path.join(createManagedTempDirectory('entitykit-order-sqlite-'), 'claims.sqlite'));
});
