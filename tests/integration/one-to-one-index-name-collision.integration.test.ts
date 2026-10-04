import { definePhysicalIndexNameTests } from '../support/physical-index-name-support';
import { requireDefined } from '../support/require-defined';

const postgresUrl = process.env.DATABASE_URL;
const mysqlUrl = process.env.MYSQL_URL ?? process.env.MYSQL_DATABASE_URL;
const describePostgres = process.env.RUN_POSTGRES_TESTS === 'true' && postgresUrl ? describe : describe.skip;
const describeMySql = process.env.RUN_MYSQL_TESTS === 'true' && mysqlUrl ? describe : describe.skip;

describePostgres('one-to-one physical index names in Postgres', () => {
    definePhysicalIndexNameTests('postgres', () => requireDefined(postgresUrl));
});
describeMySql('one-to-one physical index names in MySQL', () => {
    definePhysicalIndexNameTests('mysql', () => requireDefined(mysqlUrl));
});
