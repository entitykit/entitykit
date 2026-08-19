import type { ModificationSqlBuilder } from '../sql/modification-sql-builder';
import type { ManyToManyChange } from './many-to-many-change';
import { ManyToManyChangeValidator } from './many-to-many-change-validator';
import { buildManyToManySavePlan } from './many-to-many-save-plan';
import type { SavePlanEntry } from './save-plan';
import { registerSavePlanExecution } from './save-plan-execution';
import type { PersistedEntrySnapshot } from '../tracking/persisted-entry-snapshot';
import type { EntityEntry } from '../tracking/entity-entry';

export type { ManyToManyChange } from './many-to-many-change';

/**
 * Queued many-to-many link and unlink changes.
 *
 * Validation and save-plan construction live in focused collaborators; this
 * class owns only queue lifetime and preserves the context-facing API.
 */
export class ManyToManyChangeSet {
    private readonly changes: ManyToManyChange[] = [];
    private readonly validator: ManyToManyChangeValidator;

    constructor(trackedEntry: (entity: object) => EntityEntry<object> | undefined) {
        this.validator = new ManyToManyChangeValidator(trackedEntry);
    }

    public get size(): number {
        return this.changes.length;
    }

    /** Queue one change and return an idempotent undo for that exact change. */
    public queue(change: ManyToManyChange): () => void {
        this.validator.validate(change);
        this.changes.push(change);
        let pending = true;
        return () => {
            if (!pending) {
                return;
            }
            pending = false;
            const index = this.changes.lastIndexOf(change);
            if (index >= 0) {
                this.changes.splice(index, 1);
            }
        };
    }

    public clear(): void {
        this.changes.length = 0;
    }

    /** Remove only relationship changes represented by a committed plan. */
    public accept(accepted: readonly ManyToManyChange[]): () => void {
        const acceptedSet = new Set(accepted);
        const removed: Array<{
            readonly index: number;
            readonly change: ManyToManyChange;
        }> = [];
        for (let index = this.changes.length - 1; index >= 0; index -= 1) {
            if (acceptedSet.has(this.changes[index])) {
                removed.push({ index, change: this.changes[index] });
                this.changes.splice(index, 1);
            }
        }
        let pending = true;
        return () => {
            if (!pending) {
                return;
            }
            pending = false;
            for (const item of removed.reverse()) {
                this.changes.splice(item.index, 0, item.change);
            }
        };
    }

    /** Drop queued join work whose source or target left the context. */
    public cancelFor(entity: object): () => void {
        const removed: Array<{
            readonly index: number;
            readonly change: ManyToManyChange;
        }> = [];
        for (let index = this.changes.length - 1; index >= 0; index -= 1) {
            const change = this.changes[index];
            if (change.source === entity || change.target === entity) {
                removed.push({ index, change });
                this.changes.splice(index, 1);
            }
        }
        return () => {
            for (const item of removed.reverse()) {
                this.changes.splice(item.index, 0, item.change);
            }
        };
    }

    /**
     * Whether queued join work still names this entity as source or target.
     *
     * The mirror of {@link cancelFor}: what that method would silently drop if
     * the entity left the context now.
     */
    public hasPendingFor(entity: object): boolean {
        return this.changes.some(
            change => change.source === entity || change.target === entity,
        );
    }

    public buildSavePlan(
        sql: ModificationSqlBuilder,
        snapshotsByEntity: ReadonlyMap<object, PersistedEntrySnapshot>,
    ): SavePlanEntry[] {
        const plan = buildManyToManySavePlan(
            this.changes,
            this.validator,
            sql,
            snapshotsByEntity,
        );
        if (plan[0]) {
            registerSavePlanExecution(plan[0], {
                manyToManyChanges: [...this.changes],
            });
        }
        return plan;
    }
}
