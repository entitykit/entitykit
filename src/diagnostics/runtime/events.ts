import type { SqlStatement } from '../../sql/sql-statement';
import type { SaveChangesDiagnosticEvent } from './save-events';

export type {
    SaveChangesDiagnosticEvent,
    SaveChangesDiagnosticPlanEntry,
    SaveDurability,
} from './save-events';

/** Diagnostic event emitted for runtime diagnostic. */ export type RuntimeDiagnosticEvent =
  | QueryDiagnosticEvent
  | QueryPlanDiagnosticEvent
  | IncludeDiagnosticEvent
  | LazyLoadDiagnosticEvent
  | TransactionDiagnosticEvent
  | SaveChangesDiagnosticEvent
  | MigrationDiagnosticEvent;

/** Diagnostic event emitted for query diagnostic. */ export interface QueryDiagnosticEvent {
    /** The kind. */ readonly kind: 'query';
    /** Name of the configured database provider. */ readonly provider: string;
    /** Parameterized SQL statement associated with this operation. */ readonly statement: SqlStatement;
    /** The duration ms. */ readonly durationMs: number;
    /** Number of rows affected or returned. */ readonly rowCount?: number;
    /** The error. */ readonly error?: unknown;
}

/** Public contract for query plan shape. */ export interface QueryPlanShape {
    /** The entity name. */ readonly entityName: string;
    /** The operation. */ readonly operation:
    | 'toArray'
    | 'stream'
    | 'count'
    | 'countBigInt'
    | 'exists'
    | 'projection'
    | 'aggregate'
    | 'executeUpdate'
    | 'executeDelete'
    | 'upsert';
    /** Whether predicate. */ readonly hasPredicate: boolean;
    /** The join count. */ readonly joinCount: number;
    /** The join kinds. */ readonly joinKinds: readonly string[];
    /** The relation existence count. */ readonly relationExistenceCount?: number;
    /** Whether anti relation existence. */ readonly hasAntiRelationExistence?: boolean;
    /** Whether many to many relation existence. */ readonly hasManyToManyRelationExistence?: boolean;
    /** The ordering count. */ readonly orderingCount: number;
    /** The include count. */ readonly includeCount: number;
    /** The projection count. */ readonly projectionCount: number;
    /** The aggregate count. */ readonly aggregateCount?: number;
    /** The group key count. */ readonly groupKeyCount?: number;
    /** Whether having. */ readonly hasHaving?: boolean;
    /** The aggregate ordering count. */ readonly aggregateOrderingCount?: number;
    /** Whether offset. */ readonly hasOffset: boolean;
    /** Whether limit. */ readonly hasLimit: boolean;
    /** The ignores query filters. */ readonly ignoresQueryFilters: boolean;
    /** The ignores tenant scope. */ readonly ignoresTenantScope: boolean;
    /** The tracking behavior. */ readonly trackingBehavior?: 'track' | 'noTracking';
}

/** Diagnostic event emitted for query plan diagnostic. */ export interface QueryPlanDiagnosticEvent {
    /** The kind. */ readonly kind: 'queryPlan';
    /** Name of the configured database provider. */ readonly provider: string;
    /** The phase. */ readonly phase: 'compile' | 'execute';
    /** The shape. */ readonly shape: QueryPlanShape;
    /** The sql text. */ readonly sqlText?: string;
    /** The duration ms. */ readonly durationMs: number;
    /** Number of rows affected or returned. */ readonly rowCount?: number;
    /** The result count. */ readonly resultCount?: number;
    /** The error. */ readonly error?: unknown;
}

/** Diagnostic event emitted for include diagnostic. */ export interface IncludeDiagnosticEvent {
    /** The kind. */ readonly kind: 'include';
    /** Name of the configured database provider. */ readonly provider: string;
    /** The parent entity name. */ readonly parentEntityName: string;
    /** The related entity name. */ readonly relatedEntityName: string;
    /** The navigation property. */ readonly navigationProperty: string;
    /** The strategy. */ readonly strategy:
    | 'splitQuery'
    | 'windowedBatch'
    | 'perParentFallback'
    | 'skipped';
    /** The parent count. */ readonly parentCount: number;
    /** The key count. */ readonly keyCount: number;
    /** Number of rows affected or returned. */ readonly rowCount: number;
    /** The loaded count. */ readonly loadedCount: number;
    /** The duration ms. */ readonly durationMs: number;
}

/** Diagnostic event emitted for lazy load diagnostic. */ export interface LazyLoadDiagnosticEvent {
    /** The kind. */ readonly kind: 'lazyLoad';
    /** Name of the configured database provider. */ readonly provider: string;
    /** The entity name. */ readonly entityName: string;
    /** The navigation property. */ readonly navigationProperty: string;
    /** The queried. */ readonly queried: boolean;
    /** The context load count. */ readonly contextLoadCount: number;
    /** The duration ms. */ readonly durationMs: number;
}

/** Diagnostic event emitted for transaction diagnostic. */ export interface TransactionDiagnosticEvent {
    /** The kind. */ readonly kind: 'transaction';
    /** Name of the configured database provider. */ readonly provider: string;
    /** The phase. */ readonly phase:
    | 'begin'
    | 'commit'
    | 'rollback'
    | 'savepoint'
    | 'release'
    | 'rollbackToSavepoint';
    /** The duration ms. */ readonly durationMs?: number;
    /** The error. */ readonly error?: unknown;
}

/** Diagnostic event emitted for migration diagnostic. */ export interface MigrationDiagnosticEvent {
    /** The kind. */ readonly kind: 'migration';
    /** Name of the configured database provider. */ readonly provider: string;
    /** The phase. */ readonly phase:
    | 'discovery'
    | 'pending'
    | 'apply'
    | 'rollback'
    | 'lockAcquire'
    | 'lockRelease'
    | 'checksumFailure'
    | 'historyValidationFailure';
    /** The duration ms. */ readonly durationMs: number;
    /** The migration id. */ readonly migrationId?: string;
    /** The migration name. */ readonly migrationName?: string;
    /** The direction. */ readonly direction?: 'up' | 'down';
    /** The migration count. */ readonly migrationCount?: number;
    /** The statement count. */ readonly statementCount?: number;
    /** The transaction suppressed statements. */ readonly transactionSuppressedStatements?: number;
    /** The pending migrations. */ readonly pendingMigrations?: readonly string[];
    /** The target. */ readonly target?: string;
    /** The error. */ readonly error?: unknown;
}

/** Public type representing runtime diagnostics handler. */ export type RuntimeDiagnosticsHandler = (
    event: RuntimeDiagnosticEvent,
) => void;

/** Options that configure diagnostics. */ export interface DiagnosticsOptions {
    /** Include SQL values, tracked entities, key values, and original errors. */
    readonly includeSensitiveData?: boolean;
}
