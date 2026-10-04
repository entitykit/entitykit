import { postgresProviderServices } from '../../packages/postgres/src';
import { mySqlProviderServices } from '../../packages/mysql/src';
import { defineOperationSignalProviderTests } from '../support/operation-signal-provider-contract';
import { requireDefined } from '../support/require-defined';

const postgresUrl = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
const mysqlUrl = process.env.MYSQL_URL ?? process.env.MYSQL_DATABASE_URL;
const postgres = process.env.RUN_POSTGRES_TESTS === 'true' && Boolean(postgresUrl) ? describe : describe.skip;
const mysql = process.env.RUN_MYSQL_TESTS === 'true' && Boolean(mysqlUrl) ? describe : describe.skip;

postgres('Postgres operation signal wrapper', () => {
    defineOperationSignalProviderTests(() => postgresProviderServices.createConnection(requireDefined(postgresUrl)));
});

mysql('MySQL operation signal wrapper', () => {
    defineOperationSignalProviderTests(() => mySqlProviderServices.createConnection(requireDefined(mysqlUrl)));
});
