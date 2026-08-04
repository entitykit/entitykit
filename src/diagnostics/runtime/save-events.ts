import type { SavePlanEntry } from '../../core/save-plan';
import type { SqlStatement } from '../../sql/sql-statement';

export type SaveDurability =
    | 'committed'
    | 'pendingTransaction'
    | 'failed'
    | 'unknown';

/** Diagnostic event emitted for save changes diagnostic. */ export interface SaveChangesDiagnosticEvent {
    /** The kind. */ readonly kind: 'saveChanges';
    /** Name of the configured database provider. */ readonly provider: string;
    /** The plan. */ readonly plan: readonly SaveChangesDiagnosticPlanEntry[];
    /** The duration ms. */ readonly durationMs: number;
    /** Whether the save is durable, still pending an outer transaction, or failed. */
    readonly durability: SaveDurability;
    /** The affected entities. */ readonly affectedEntities?: number;
    /** The error. */ readonly error?: unknown;
}

/** Public contract for save changes diagnostic plan entry. */ export interface SaveChangesDiagnosticPlanEntry {
    /** The entity name. */ readonly entityName: string;
    /** The state. */ readonly state: SavePlanEntry['state'];
    /** Parameterized SQL statement associated with this operation. */ readonly statement: SqlStatement;
    /** The affected entity count. */ readonly affectedEntityCount?: number;
    /** The expected affected rows. */ readonly expectedAffectedRows?: number;
    /** The skip affected rows check. */ readonly skipAffectedRowsCheck?: boolean;
    /** Whether system generated. */ readonly isSystemGenerated?: boolean;
    /** Present only when diagnostics explicitly include sensitive data. */
    readonly entity?: object;
    /** Present only when diagnostics explicitly include sensitive data. */
    readonly keyValue?: unknown;
}
