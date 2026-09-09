import './operation-types.js';
import './checked-materialization-types.js';
import './context-creation-types.js';
import './factory-creation-types.js';
import './creation-types.js';
// Type-level acceptance for an ESM consumer resolving the published tarballs
// under `module: NodeNext`. The `.mts` extension forces the ESM resolution
// mode, so a package whose `exports` only answers `require` fails here.
import {
    DatabaseProviderError,
    DbContext,
    EntityState,
    type EntityKitDataSource,
    type UnsafeRawSqlQueryable,
} from '@entitykit/core';
import type { DatabaseConnection } from '@entitykit/core/adapter';
import { Materializer } from '@entitykit/core/experimental';
import { Migration } from '@entitykit/core/migrations';
import { generateDbPullCode } from '@entitykit/core/tooling';
import { defineEntityKitConfig } from '@entitykit/cli';
import { mySqlProviderServices } from '@entitykit/mysql';
import {
    EntityKitModule,
    getEntityKitContextRunnerToken,
    InjectEntityKitContextRunner,
    type EntityKitContextRunner,
} from '@entitykit/nestjs';
import { postgresProviderServices } from '@entitykit/postgres';
import { sqliteProviderServices } from '@entitykit/sqlite';
import { RecordingDatabaseConnection } from '@entitykit/testing';

class NestConsumerContext extends DbContext {}
class NestArgumentContext extends DbContext {
    public constructor(
        source: EntityKitDataSource,
        public readonly requestId: string,
    ) {
        super(source);
    }
}
class InvalidNestContext extends DbContext {
    public constructor(_requestId: string) {
        super();
    }
}

declare const contextRunner: EntityKitContextRunner<NestConsumerContext>;
declare const argumentRunner: EntityKitContextRunner<
    NestArgumentContext,
    [requestId: string]
>;
declare const nestDataSource: EntityKitDataSource;
const nestFeature = EntityKitModule.forFeature([
    NestConsumerContext,
    NestArgumentContext,
]);
const argumentToken = getEntityKitContextRunnerToken(NestArgumentContext);
const argumentDecorator = InjectEntityKitContextRunner(NestArgumentContext);
// @ts-expect-error Nest contexts must accept the application data source first.
EntityKitModule.forFeature([InvalidNestContext]);
// @ts-expect-error Injection tokens enforce the same data-source-first contract.
getEntityKitContextRunnerToken(InvalidNestContext);
const nestAsyncRoot = EntityKitModule.forRootAsync({
    inject: [String],
    useFactory: async (_name: string) => ({ dataSource: nestDataSource }),
});
const argumentRun = argumentRunner.run(
    context => context.requestId,
    'request-1',
);

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
void EntityKitModule;
void contextRunner;
void argumentRun;
void argumentDecorator;
void argumentToken;
void nestFeature;
void nestAsyncRoot;
void postgresProviderServices;
void sqliteProviderServices;
void generateDbPullCode;
