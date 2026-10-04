import { sqliteProviderServices } from '../packages/sqlite/src';
import { defineOperationSignalProviderTests } from './support/operation-signal-provider-contract';

describe('SQLite operation signal wrapper', () => {
    defineOperationSignalProviderTests(() => sqliteProviderServices.createConnection(':memory:'));
});
