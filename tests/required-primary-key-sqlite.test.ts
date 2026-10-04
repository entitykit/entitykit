import path from 'node:path';
import { createManagedTempDirectory } from './support/managed-temp-directory';
import { defineRequiredPrimaryKeyProviderTests } from './support/required-primary-key-support';

describe('SQLite required primary keys', () => {
    defineRequiredPrimaryKeyProviderTests('sqlite', () => path.join(createManagedTempDirectory('entitykit-required-key-'), 'books.sqlite'));
});
