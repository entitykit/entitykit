// Type-level acceptance for an ESM consumer resolving the published tarballs
// under `module: NodeNext`. The `.mts` extension forces the ESM resolution
// mode, so a package whose `exports` only answers `require` fails here.
import {
    DatabaseProviderError,
    DbContext,
    EntityState,
    type UnsafeRawSqlQueryable,
} from '@entitykit/core';
import type { DatabaseConnection } from '@entitykit/core/adapter';
import { Materializer } from '@entitykit/core/experimental';
import { Migration } from '@entitykit/core/migrations';
import { generateDbPullCode } from '@entitykit/core/tooling';
import { defineEntityKitConfig } from '@entitykit/cli';
import { mySqlProviderServices } from '@entitykit/mysql';
import { postgresProviderServices } from '@entitykit/postgres';
import { sqliteProviderServices } from '@entitykit/sqlite';
import { RecordingDatabaseConnection } from '@entitykit/testing';

const connection: DatabaseConnection = new RecordingDatabaseConnection();
const state: EntityState = EntityState.Unchanged;

function acceptUnsafeQuery<TEntity extends object>(
    query: UnsafeRawSqlQueryable<TEntity>,
): void {
    void query;
}

void DatabaseProviderError;
void DbContext;
void connection;
void state;
void acceptUnsafeQuery;
void defineEntityKitConfig;
void Materializer;
void Migration;
void mySqlProviderServices;
void postgresProviderServices;
void sqliteProviderServices;
void generateDbPullCode;
