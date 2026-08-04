import {
    DbContext,
    type UnsafeRawSqlQueryable,
} from 'entitykit';
import type { DatabaseConnection } from 'entitykit/adapter';
import { defineEntityKitConfig } from 'entitykit/cli';
import { Materializer } from 'entitykit/experimental';
import { Migration } from 'entitykit/migrations';
import { mySqlProviderServices } from 'entitykit/mysql';
import { postgresProviderServices } from 'entitykit/postgres';
import { sqliteProviderServices } from 'entitykit/sqlite';
import { RecordingDatabaseConnection } from 'entitykit/testing';
import { generateDbPullCode } from 'entitykit/tooling';

const connection: DatabaseConnection = new RecordingDatabaseConnection();

function acceptUnsafeQuery<TEntity extends object>(
    query: UnsafeRawSqlQueryable<TEntity>,
): void {
    void query;
}

void DbContext;
void connection;
void acceptUnsafeQuery;
void defineEntityKitConfig;
void Materializer;
void Migration;
void mySqlProviderServices;
void postgresProviderServices;
void sqliteProviderServices;
void generateDbPullCode;
