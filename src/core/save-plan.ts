import type { EntityState } from '../tracking/entity-state';
import type { SqlStatement } from '../sql/sql-statement';

/**
 * One statement a `saveChanges()` will run, with the entity it came from.
 *
 * A dependent insert whose foreign key awaits a database-generated principal
 * key is the one deferred case: its statement shape is final, but its previewed
 * foreign-key value is replaced after the principal insert succeeds.
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
    /** The expected affected rows. */ readonly expectedAffectedRows?: number;
    /** The skip affected rows check. */ readonly skipAffectedRowsCheck?: boolean;
    /** Whether system generated. */ readonly isSystemGenerated?: boolean;
}
