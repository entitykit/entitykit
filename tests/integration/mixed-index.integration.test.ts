import { defineMixedIndexProviderTests } from '../support/mixed-index-provider-contract';
import { requireDefined } from '../support/require-defined';
const postgresUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
const mysqlUrl = process.env.MYSQL_URL ?? process.env.MYSQL_DATABASE_URL;
const postgres = process.env.RUN_POSTGRES_TESTS === 'true' && Boolean(postgresUrl) ? describe : describe.skip;
const mysql = process.env.RUN_MYSQL_TESTS === 'true' && Boolean(mysqlUrl) ? describe : describe.skip;
postgres('Postgres mixed Bookshop index recreation', () => {
    defineMixedIndexProviderTests('postgres', () => requireDefined(postgresUrl));
});
mysql('MySQL mixed Bookshop index recreation', () => {
    defineMixedIndexProviderTests('mysql', () => requireDefined(mysqlUrl));
});
