import { requireDefined } from '../support/require-defined';
import { defineOneToOneIndexProviderTests } from '../support/one-to-one-index-support';

const postgresUrl = process.env.DATABASE_URL;
const mysqlUrl = process.env.MYSQL_URL ?? process.env.MYSQL_DATABASE_URL;
const describePostgres = process.env.RUN_POSTGRES_TESTS === 'true' && postgresUrl ? describe : describe.skip;
const describeMySql = process.env.RUN_MYSQL_TESTS === 'true' && mysqlUrl ? describe : describe.skip;

describePostgres('Postgres one-to-one index enforcement', () => {
    defineOneToOneIndexProviderTests('postgres', () => requireDefined(postgresUrl));
});
describeMySql('MySQL one-to-one index enforcement', () => {
    defineOneToOneIndexProviderTests('mysql', () => requireDefined(mysqlUrl));
});
