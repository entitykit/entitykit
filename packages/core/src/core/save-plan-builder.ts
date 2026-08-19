import type { DbContextOptions } from './context-options/db-context-option-types';
import type { ChangeTracker } from '../tracking/change-tracker';
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
import { buildRelationshipAuthorizationSavePlan } from './relationship-authorization-save-plan';
import { assembleSavePlan } from './save-plan/assemble-plan';
import type { RestorationScope } from '../restoration-scope';
import { prepareSaveEntries } from './save-plan/prepared-entries';

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
    public build(
        restoration: RestorationScope,
        options: { readonly continueSaveAttempt?: boolean } = {},
    ): SavePlanEntry[] {
        try {
            if (!options.continueSaveAttempt) {
                this.deps.saveTimeWrites.begin();
            } else {
                this.deps.saveTimeWrites.beginGeneration(restoration);
            }
            return this.buildPreparedPlan(restoration);
        } catch (error) {
            restoration.capturePrimary(error);
            restoration.attempt(
                this.deps.saveTimeWrites.restore.bind(
                    this.deps.saveTimeWrites,
                ),
            );
            throw error;
        }
    }

    private buildPreparedPlan(restoration: RestorationScope): SavePlanEntry[] {
        const { snapshots, pending } = prepareSaveEntries(
            this.deps.changeTracker,
            this.deps.saveTimeWrites,
            restoration,
        );
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
    public debugView(restoration: RestorationScope): string {
        return formatSavePlanDebug(this.build(restoration));
    }
}
