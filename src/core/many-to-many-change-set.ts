import type { ModificationSqlBuilder } from '../sql/modification-sql-builder';
import type { ManyToManyChange } from './many-to-many-change';
import { ManyToManyChangeValidator } from './many-to-many-change-validator';
import { buildManyToManySavePlan } from './many-to-many-save-plan';
import type { SavePlanEntry } from './save-plan';
import { registerSavePlanExecution } from './save-plan-execution';

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

    constructor(isTracked: (entity: object) => boolean) {
        this.validator = new ManyToManyChangeValidator(isTracked);
    }

    public get size(): number {
        return this.changes.length;
    }

    public queue(change: ManyToManyChange): void {
        this.validator.validate(change);
        this.changes.push(change);
    }

    public clear(): void {
        this.changes.length = 0;
    }

    /** Remove only relationship changes represented by a committed plan. */
    public accept(accepted: readonly ManyToManyChange[]): void {
        const acceptedSet = new Set(accepted);
        for (let index = this.changes.length - 1; index >= 0; index -= 1) {
            if (acceptedSet.has(this.changes[index])) {
                this.changes.splice(index, 1);
            }
        }
    }

    /** Drop queued join work whose source or target was a canceled addition. */
    public cancelFor(entity: object): void {
        for (let index = this.changes.length - 1; index >= 0; index -= 1) {
            const change = this.changes[index];
            if (change.source === entity || change.target === entity) {
                this.changes.splice(index, 1);
            }
        }
    }

    public buildSavePlan(sql: ModificationSqlBuilder): SavePlanEntry[] {
        const plan = buildManyToManySavePlan(
            this.changes,
            this.validator,
            sql,
        );
        if (plan[0]) {
            registerSavePlanExecution(plan[0], {
                manyToManyChanges: [...this.changes],
            });
        }
        return plan;
    }
}
