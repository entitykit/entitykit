import type { DbContextOptionsBuilder } from '../../../src';
import type { DatabaseProviderServices, SqlStatement } from '../../../src/adapter';
import type { MigrationUpdateResult } from '../../../src/migrations/api';
import type { CreateProviderContractUsers } from './migrations';
import type { ProviderContractDbContext, ProviderContractUser } from './model';

export interface ProviderContractRuntime {
    readonly providerName: string;
    readonly providerServices: DatabaseProviderServices;
    readonly expectedSelectStatement: SqlStatement;
    readonly expectedRawSqlStatement: SqlStatement;
    readonly expectedMigrationOperationFragments: readonly string[];
    readonly expectedIdempotentScriptFragments?: readonly string[];
    readonly expectedUsesMigrationLock: boolean;
    /**
   * Most bound parameters one statement may carry, or `null` for a provider
   * with no wire and therefore no cap. Required so a new adapter has to answer
   * the question rather than inherit a silent default.
   */
    readonly expectedMaxStatementParameters: number | null;
    /**
   * Whether this provider can express an upsert. Required so a new adapter
   * answers the question rather than inheriting a silent default.
   */
    readonly expectedSupportsUpsert: boolean;
    /** Whether the connection implements the optional streaming capability. */
    readonly expectedSupportsStreaming: boolean;
    configure(options: DbContextOptionsBuilder): void;
    beforeEach?(db: ProviderContractDbContext): Promise<void> | void;
    afterEach?(db: ProviderContractDbContext): Promise<void> | void;
    beforeSave?(db: ProviderContractDbContext): Promise<void> | void;
    beforeRead?(db: ProviderContractDbContext): Promise<void> | void;
    afterSaveAndRead?(db: ProviderContractDbContext, user: ProviderContractUser): Promise<void> | void;
    beforeRollback?(db: ProviderContractDbContext): Promise<void> | void;
    afterRollback?(db: ProviderContractDbContext): Promise<void> | void;
    beforeNestedTransaction?(db: ProviderContractDbContext): Promise<void> | void;
    afterNestedTransaction?(db: ProviderContractDbContext): Promise<void> | void;
    beforeDiagnosticsSave?(db: ProviderContractDbContext): Promise<void> | void;
    beforeMigrationUpdate?(db: ProviderContractDbContext, migration: CreateProviderContractUsers): Promise<void> | void;
    beforeSecondMigrationUpdate?(db: ProviderContractDbContext, migration: CreateProviderContractUsers): Promise<void> | void;
    afterMigrationUpdate?(db: ProviderContractDbContext, result: MigrationUpdateResult): Promise<void> | void;
    beforeMigrationRollback?(db: ProviderContractDbContext, migration: CreateProviderContractUsers): Promise<void> | void;
    afterMigrationRollback?(db: ProviderContractDbContext, result: MigrationUpdateResult): Promise<void> | void;
    expectProviderError(db: ProviderContractDbContext): Promise<void>;
    expectSchemaIntrospection?(db: ProviderContractDbContext): Promise<void>;
    /**
   * Ensure an empty `provider_contract_values` table exists, opting in to the
   * typed round-trip contract. Providers without real storage omit this.
   */
    prepareValueRoundTrip?(db: ProviderContractDbContext): Promise<void>;
    /**
   * Ensure empty `provider_contract_parents`/`provider_contract_children` tables
   * exist, opting in to the join contract. Providers without real storage omit
   * this.
   */
    prepareJoinData?(db: ProviderContractDbContext): Promise<void>;
}

export type ProviderContractRuntimeFactory = () => ProviderContractRuntime;
