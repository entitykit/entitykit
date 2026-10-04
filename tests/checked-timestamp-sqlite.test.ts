import { defineCheckedTimestampTests } from './support/checked-timestamp-support';

describe('checked timestamp precision through SQLite', () => {
    defineCheckedTimestampTests('sqlite', () => ':memory:');
});
