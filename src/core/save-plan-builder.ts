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
    public build(): SavePlanEntry[] {
        try {
            return this.buildPreparedPlan();
        } catch (error) {
            this.deps.saveTimeWrites.restore();
            throw error;
        }
    }

    private buildPreparedPlan(): SavePlanEntry[] {
        this.prepareEntriesForSave();

        const pending = orderSaveEntries(this.deps.changeTracker.entries().filter(entry =>
            entry.state === EntityState.Added ||
      entry.state === EntityState.Modified ||
      entry.state === EntityState.Deleted,
        ));

        const sql = new ModificationSqlBuilder(this.deps.getDialect());
        const entityPlan = buildEntitySavePlan(sql, this.deps.getDialect(), pending);
        const manyToManyPlan = this.deps.manyToMany.buildSavePlan(sql);
        const unlinkPlan = manyToManyPlan.filter(entry => entry.state === EntityState.Deleted);
        const linkPlan = manyToManyPlan.filter(entry => entry.state === EntityState.Added);
        const entityNonDeletes = entityPlan.filter(entry => entry.state !== EntityState.Deleted);
        const entityDeletes = entityPlan.filter(entry => entry.state === EntityState.Deleted);
        const outboxPlan = buildOutboxSavePlan({
            sql,
            outbox: this.deps.getOptions().outbox,
            entries: pending,
            eventTracker: this.deps.outboxEvents,
            currentAuditTimestamp: this.deps.currentAuditTimestamp,
        });

        return freezeSavePlan([
            ...entityNonDeletes,
            ...linkPlan,
            ...unlinkPlan,
            ...entityDeletes,
            ...outboxPlan,
        ]);
    }

    /** A human-readable view of the pending save plan, for debugging. */
    public debugView(): string {
        return formatSavePlanDebug(this.build());
    }

    private prepareEntriesForSave(): void {
        this.deps.changeTracker.detectChanges();

        // Save-time writes can change what is dirty, so detect again only when an
        // entity could actually have been touched.
        if (this.deps.saveTimeWrites.applyTo(this.deps.changeTracker.entries())) {
            this.deps.changeTracker.detectChanges();
        }
    }
}
