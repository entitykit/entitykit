import type { EntityEntry } from '../tracking/entity-entry';
import { applyAuditWrites } from './save-time-audit';
import { SaveTimeMutationLog } from './save-time-mutations';
import type { SaveTimeScope } from './save-time-scope';
import { applySoftDeleteWrite } from './save-time-soft-delete';
import { applyTenantWrite } from './save-time-tenant';

/**
 * The writes a save makes into entities before persisting them: audit
 * timestamps and users, the soft-delete marker, and the tenant key.
 *
 * They are recorded as they are made so a failed save can put them back. Entity
 * state and version numbers are restored elsewhere in the save lifecycle.
 */
export class SaveTimeWrites {
    private readonly mutations = new SaveTimeMutationLog();

    constructor(private readonly scope: SaveTimeScope) {}

    /**
   * Apply every save-time write to the tracked entries.
   *
   * Returns whether any entry could have been touched, so the caller knows
   * whether re-running change detection is worth it.
   */
    public applyTo(entries: Iterable<EntityEntry<object>>): boolean {
        let now: Date | undefined;
        let userId: unknown;
        let userIdInitialized = false;
        let mayHaveWritten = false;

        const currentTime = (): Date => {
            now ??= this.scope.now();
            return now;
        };
        const currentUser = (): unknown => {
            if (!userIdInitialized) {
                userId = this.scope.currentUserId();
                userIdInitialized = true;
            }
            return userId;
        };

        this.mutations.reset();
        for (const entry of entries) {
            const tenantKeyProperty: unknown = entry.metadata.tenantKeyProperty;
            mayHaveWritten ||= Boolean(
                tenantKeyProperty ??
                entry.metadata.softDelete ??
                entry.metadata.audit,
            );
            applyTenantWrite(entry, this.scope.currentTenantId(), this.mutations);
            applySoftDeleteWrite(entry, currentTime, this.mutations);
            applyAuditWrites(entry, currentTime, currentUser, this.mutations);
        }

        return mayHaveWritten;
    }

    /** Undo the writes, newest first, so an entity survives a failure unchanged. */
    public restore(): void {
        this.mutations.restore();
    }

    /** Accept the writes; called once a save has committed. */
    public accept(): void {
        this.mutations.accept();
    }
}

export type { SaveTimeScope } from './save-time-scope';
