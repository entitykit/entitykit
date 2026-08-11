import { applyAuditWrites } from './save-time-audit';
import { SaveTimeMutationLog } from './save-time-mutations';
import type { SaveTimeScope } from './save-time-scope';
import { applySoftDeleteWrite } from './save-time-soft-delete';
import {
    applyTenantWrite,
} from './save-time-tenant';
import { capturePreparedTenantProviderFacts } from './prepared-tenant-provider-facts';
import type { PersistedEntrySnapshot } from '../tracking/persisted-entry-snapshot';
import { captureMissingBoundEntityValues } from '../tracking/bound-value-snapshot';
import type { ChangeTracker } from '../tracking/change-tracker';
import {
    rememberSaveTimeRelationshipWrites,
    reconcileSaveTimeRelationships,
} from './save-time-relationship-reconciliation';

/**
 * The writes a save makes into entities before persisting them: audit
 * timestamps and users, the soft-delete marker, and the tenant key.
 *
 * They are recorded as they are made so a failed save can put them back. Entity
 * state and version numbers are restored elsewhere in the save lifecycle.
 */
export class SaveTimeWrites {
    private readonly mutations = new SaveTimeMutationLog();
    private readonly relationshipProperties: Map<object, Set<string>> = new Map();
    private nowMs?: number;
    private userId: unknown;
    private userIdInitialized = false;
    private tenantId: unknown;
    private tenantIdInitialized = false;

    constructor(private readonly scope: SaveTimeScope) {}

    /** Start one save attempt and snapshot its request-scoped values lazily. */
    public begin(): void {
        this.mutations.reset();
        this.relationshipProperties.clear();
        this.nowMs = undefined;
        this.userId = undefined;
        this.userIdInitialized = false;
        this.tenantId = undefined;
        this.tenantIdInitialized = false;
    }

    /** Rebuild the plan while retaining stable request-scoped save values. */
    public beginGeneration(): void {
        this.mutations.restore();
        this.relationshipProperties.clear();
    }

    /**
     * Apply policy writes to the captured values and mirror them into the live
     * entities under the rollback journal.
     */
    public applyTo(
        snapshots: readonly PersistedEntrySnapshot[],
    ): PersistedEntrySnapshot[] {
        const currentTime = (): Date => {
            this.nowMs ??= this.scope.now().getTime();
            return new Date(this.nowMs);
        };
        const currentUser = (): unknown => {
            if (!this.userIdInitialized) {
                this.userId = this.scope.currentUserId();
                this.userIdInitialized = true;
            }
            return this.userId;
        };
        const currentTenant = (): unknown => {
            if (!this.tenantIdInitialized) {
                this.tenantId = this.scope.currentTenantId();
                this.tenantIdInitialized = true;
            }
            return this.tenantId;
        };

        return snapshots.map(snapshot => {
            const tenantId = currentTenant();
            const allowsCrossTenantAccess = this.scope.allowsCrossTenantAccess();
            const tenantWritten = applyTenantWrite(
                snapshot,
                tenantId,
                allowsCrossTenantAccess,
                this.mutations,
            );
            const prepared = applySoftDeleteWrite(
                snapshot,
                currentTime,
                this.mutations,
            );
            applyAuditWrites(
                prepared,
                currentTime,
                currentUser,
                this.mutations,
            );
            rememberSaveTimeRelationshipWrites(
                this.relationshipProperties,
                prepared,
                tenantWritten,
            );
            capturePreparedTenantProviderFacts(
                prepared,
                tenantId,
                allowsCrossTenantAccess,
            );
            captureMissingBoundEntityValues(
                prepared.entry.metadata,
                prepared.values,
                prepared.boundValues,
            );
            return prepared;
        });
    }

    /** Reconcile graph state after final policy-managed FK writes. */
    public reconcileRelationships(
        changeTracker: ChangeTracker,
    ): ReadonlyMap<object, ReadonlySet<string>> {
        reconcileSaveTimeRelationships(
            changeTracker,
            this.mutations,
            changeTracker.entries().filter(entry =>
                this.relationshipProperties.has(entry.entity)),
        );
        return this.relationshipProperties;
    }

    /** Undo the writes, newest first, so an entity survives a failure unchanged. */
    public restore(): void {
        this.mutations.restore();
    }

    /** Accept the writes; called once a save has committed. */
    public accept(): void {
        this.mutations.accept();
    }

    /** Accept these writes while retaining rollback for an outer transaction. */
    public acceptWithRollback(): () => void {
        return this.mutations.takeRollback();
    }
}

export type { SaveTimeScope } from './save-time-scope';
