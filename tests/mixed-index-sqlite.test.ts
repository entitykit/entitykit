import path from 'node:path';
import { createManagedTempDirectory } from './support/managed-temp-directory';
import { defineMixedIndexProviderTests } from './support/mixed-index-provider-contract';

describe('SQLite mixed Bookshop index recreation', () => {
    defineMixedIndexProviderTests('sqlite', () => path.join(createManagedTempDirectory('entitykit-mixed-index-'), 'books.sqlite'));
});
