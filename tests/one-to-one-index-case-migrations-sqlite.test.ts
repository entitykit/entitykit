import { defineSqliteCaseIndexMigrationTests } from './support/physical-index-case-migration-support';

describe('SQLite case-equivalent physical indexes in populated migrations', () => {
    defineSqliteCaseIndexMigrationTests();
});
