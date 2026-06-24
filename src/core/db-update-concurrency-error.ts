import type { EntityState } from '../tracking/entity-state';
import type { EntityEntry } from '../tracking/entity-entry-types';
import { DbUpdateError } from '../errors/db-update-error';

/** Typed error reported for db update concurrency failures. */ export class DbUpdateConcurrencyError extends DbUpdateError {
    /** The entries. */ public readonly entries: ReadonlyArray<EntityEntry<object>>;
    /** Entity type whose update lost an optimistic-concurrency race. */ public readonly entityName: string;
    /** Key of the entity whose update conflicted. */ public readonly keyValue: unknown;
    /** Tracked state used for the failed write. */ public readonly state: EntityState;
    /** Number of rows actually affected by the write. */ public readonly rowCount: number;

    constructor(
        entityName: string,
        keyValue: unknown,
        state: EntityState,
        rowCount: number,
        entry?: EntityEntry<object>,
    ) {
        super(`Concurrency conflict while saving '${entityName}' with key '${String(keyValue)}'. Expected 1 affected row for ${state}, but affected ${String(rowCount)}.`, {
            code: 'DB_CONCURRENCY_CONFLICT',
            details: {
                entityName,
                keyValue,
                state,
                rowCount,
            },
        });
        this.name = 'DbUpdateConcurrencyError';
        this.entityName = entityName;
        this.keyValue = keyValue;
        this.state = state;
        this.rowCount = rowCount;
        this.entries = entry ? Object.freeze([entry]) : Object.freeze([]);
    }

    /** The conflicting tracked entry, when the failure came from saveChanges. */
    public get entry(): EntityEntry<object> | undefined {
        return this.entries[0];
    }
}
