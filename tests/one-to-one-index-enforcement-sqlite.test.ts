import { defineOneToOneIndexProviderTests } from './support/one-to-one-index-support';

describe('one-to-one uniqueness with configured SQLite indexes', () => {
    defineOneToOneIndexProviderTests('sqlite', () => ':memory:');
});
