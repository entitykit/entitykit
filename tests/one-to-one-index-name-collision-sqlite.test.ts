import { definePhysicalIndexNameTests } from './support/physical-index-name-support';

describe('one-to-one physical index names in SQLite', () => {
    definePhysicalIndexNameTests('sqlite', () => ':memory:');
});
