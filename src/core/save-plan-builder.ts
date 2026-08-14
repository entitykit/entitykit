import type { DbContextOptions } from './context-options/db-context-option-types';
import type { ChangeTracker } from '../tracking/change-tracker';
import { EntityState } from '../tracking/entity-state';
import type { SqlDialect } from '../sql/sql-dialect';
import { ModificationSqlBuilder } from '../sql/modification-sql-builder';
import type { ManyToManyChangeSet } from './many-to-many-change-set';
import type { OutboxEventTracker } from './outbox-event-tracker';
import type { SaveTimeWrites } from './save-time-writes';
import type { SavePlanEntry } from './save-plan';
import { buildEntitySavePlan } from './save-plan/entity-plan';
import { formatSavePlanDebug } from './save-plan/format-debug-view';
import { freezeSavePlan } from './save-plan/freeze-plan';
import { buildOutboxSavePlan } from './save-plan/outbox-plan';
import { orderSaveEntries } from './save-plan/order-entries';
import {
    capturePersistedEntrySnapshot,
    refreshPersistedEntryRelationships,
} from '../tracking/persisted-entry-snapshot';
import { refreshRelationshipPlanSnapshot } from './relationship-plan-snapshot';
import { buildRelationshipAuthorizationSavePlan } from './relationship-authorization-save-plan';
import { assembleSavePlan } from './save-plan/assemble-plan';
import { changeTrackerModel } from '../tracking/change-tracker-model';

/** Dependencies the save-plan coordinator receives from its context. */
export interface SavePlanBuilderDeps {
    readonly changeTracker: ChangeTracker;
    readonly manyToMany: ManyToManyChangeSet;
    readonly outboxEvents: OutboxEventTracker;
    readonly saveTimeWrites: SaveTimeWrites;
    readonly getDialect: () => SqlDialect;
    readonly getOptions: () => DbContextOptions;
    readonly currentAuditTimestamp: () => Date;
}

/**
 * Coordinates plan construction without executing any statements.
 *
 * Entity writes, insert batching, outbox collection, ordering, freezing, and
 * debug formatting each live with their concrete owner under `save-plan/`.
 */
export class SavePlanBuilder {
    constructor(private readonly deps: SavePlanBuilderDeps) {}

    /** Build the frozen SQL save plan for the current tracked changes. */
    public build(options: { readonly continueSaveAttempt?: boolean } = {}): SavePlanEntry[] {
        if (!options.continueSaveAttempt) {
            this.deps.saveTimeWrites.begin();
        } else {
            this.deps.saveTimeWrites.beginGeneration();
        }
        try {
            return this.buildPreparedPlan();
        } catch (error) {
            this.deps.saveTimeWrites.restore();
            throw error;
        }
    }

    private buildPreparedPlan(): SavePlanEntry[] {
        const tracked = this.deps.changeTracker.entries();
        let snapshots = tracked.map(capturePersistedEntrySnapshot);
        const relationshipValues = new Map(snapshots.map(snapshot => [
            snapshot.entry,
            snapshot.values,
        ]));
        const relationshipGeneration =
            this.deps.saveTimeWrites.beginRelationshipGeneration(snapshots);
        try {
            this.deps.changeTracker.detectSaveRelationships(
                undefined,
                relationshipValues,
            );
        } finally {
            relationshipGeneration.complete();
        }
        const relationshipChanges =
            relationshipGeneration.changedForeignKeyEntries();
        const retainedEntries = new Set(this.deps.changeTracker.entries());
        snapshots = snapshots
            .filter(snapshot => retainedEntries.has(snapshot.entry))
            .map(snapshot => refreshRelationshipPlanSnapshot(
                snapshot,
                relationshipChanges.has(snapshot.entry),
            ));
        snapshots = this.deps.saveTimeWrites.applyTo(snapshots);
        const reconciled = this.deps.saveTimeWrites.reconcileRelationships(
            this.deps.changeTracker,
        );
        snapshots = snapshots.map(snapshot => {
            const changes = reconciled.get(snapshot.entry.entity);
            return changes
                ? refreshPersistedEntryRelationships(
                    snapshot,
                    changes.foreignKeys,
                )
                : snapshot;
        });
        this.deps.saveTimeWrites.rememberRelationshipAcceptance(
            snapshots.filter(snapshot =>
                (reconciled.get(snapshot.entry.entity)?.navigations.size ?? 0) > 0),
        );
        const configuredModel = changeTrackerModel(this.deps.changeTracker);
        if (!configuredModel) {
            throw new Error('Save planning requires a configured model.');
        }
        const pending = orderSaveEntries(snapshots.filter(snapshot =>
            snapshot.state === EntityState.Added ||
            snapshot.state === EntityState.Modified ||
            snapshot.state === EntityState.Deleted,
        ), this.deps.changeTracker, configuredModel, snapshots);

        const dialect = this.deps.getDialect();
        const sql = new ModificationSqlBuilder(dialect);
        const entityPlan = buildEntitySavePlan(sql, dialect, pending);
        const relationshipAuthorization = buildRelationshipAuthorizationSavePlan(
            sql,
            this.deps.changeTracker,
            snapshots,
        );
        const snapshotsByEntity = new Map(snapshots.map(snapshot => [
            snapshot.entry.entity,
            snapshot,
        ]));
        const manyToManyPlan = this.deps.manyToMany.buildSavePlan(
            sql,
            snapshotsByEntity,
        );
        const outboxPlan = buildOutboxSavePlan({
            sql,
            dialect,
            outbox: this.deps.getOptions().outbox,
            entries: snapshots,
            eventTracker: this.deps.outboxEvents,
            currentAuditTimestamp: this.deps.currentAuditTimestamp,
        });

        return freezeSavePlan(assembleSavePlan(
            entityPlan,
            manyToManyPlan,
            relationshipAuthorization,
            outboxPlan,
        ));
    }

    /** A human-readable view of the pending save plan, for debugging. */
    public debugView(): string {
        return formatSavePlanDebug(this.build());
    }
}
