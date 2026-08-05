import type { EntityState } from '../tracking/entity-state';
import type { SqlStatement } from '../sql/sql-statement';

export interface RelationshipSavePlanPair {
    readonly source: object;
    readonly target: object;
}

/**
 * One statement a `saveChanges()` will run, with the entity it came from.
 *
 * Deferred entries retain their final statement shape and logical relationship
 * pairs while generated key values are resolved during execution.
 *
 * Its own module because save interceptors and runtime diagnostics both name
 * it. Living inside `DbContext.ts` made each of them import the context, which
 * imports them back — a cycle across three directories for the sake of one
 * interface.
 */
export interface SavePlanEntry<TEntity extends object = object> {
    /** The entity. */ readonly entity: TEntity;
    /** The entity name. */ readonly entityName: string;
    /** The key value. */ readonly keyValue: unknown;
    /** The state. */ readonly state: EntityState;
    /** Parameterized SQL statement associated with this operation. */ readonly statement: SqlStatement;
    /** The affected entity count. */ readonly affectedEntityCount?: number;
    /** The number of logical relationship changes. */
    readonly relationshipChangeCount?: number;
    /** Every logical source and target in a relationship operation. */
    readonly relationshipPairs?: readonly RelationshipSavePlanPair[];
    /** Whether final statement values are resolved during execution. */
    readonly isDeferred?: boolean;
    /** The expected affected rows. */ readonly expectedAffectedRows?: number;
    /** The skip affected rows check. */ readonly skipAffectedRowsCheck?: boolean;
    /** Whether system generated. */ readonly isSystemGenerated?: boolean;
}
