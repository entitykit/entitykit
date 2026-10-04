import { requireDefined } from '../support/require-defined';
import { defineMigrationTableOrderProviderTests } from '../support/migration-table-order-provider-contract';

const postgresUrl = process.env.DATABASE_URL;
const mysqlUrl = process.env.MYSQL_URL ?? process.env.MYSQL_DATABASE_URL;
const describePostgres = process.env.RUN_POSTGRES_TESTS === 'true' && postgresUrl ? describe : describe.skip;
const describeMySql = process.env.RUN_MYSQL_TESTS === 'true' && mysqlUrl ? describe : describe.skip;

describePostgres('Postgres generated migration dependency ordering', () => {
    defineMigrationTableOrderProviderTests('postgres', () => requireDefined(postgresUrl));
});
describeMySql('MySQL generated migration dependency ordering', () => {
    defineMigrationTableOrderProviderTests('mysql', () => requireDefined(mysqlUrl));
});
