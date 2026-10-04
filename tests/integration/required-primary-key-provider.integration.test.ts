import { requireDefined } from '../support/require-defined';
import { defineRequiredPrimaryKeyProviderTests } from '../support/required-primary-key-support';

const postgresUrl = process.env.DATABASE_URL;
const mysqlUrl = process.env.MYSQL_URL ?? process.env.MYSQL_DATABASE_URL;
const describePostgres = process.env.RUN_POSTGRES_TESTS === 'true' && postgresUrl ? describe : describe.skip;
const describeMySql = process.env.RUN_MYSQL_TESTS === 'true' && mysqlUrl ? describe : describe.skip;

describePostgres('Postgres required primary keys', () => {
    defineRequiredPrimaryKeyProviderTests('postgres', () => requireDefined(postgresUrl));
});
describeMySql('MySQL required primary keys', () => {
    defineRequiredPrimaryKeyProviderTests('mysql', () => requireDefined(mysqlUrl));
});
