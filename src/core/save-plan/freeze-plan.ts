import type { SavePlanEntry } from '../save-plan';

/**
 * Freeze the plan before interceptors or executors can observe it.
 *
 * Execution reads the plan and mutates only the entities it names. A generated
 * principal-key dependency is rebuilt as a separate statement at execution
 * time, leaving this observable preview immutable too.
 */
export function freezeSavePlan(plan: SavePlanEntry[]): SavePlanEntry[] {
    for (const entry of plan) {
        Object.freeze(entry.statement.values);
        Object.freeze(entry.statement);
        Object.freeze(entry);
    }

    return Object.freeze(plan) as SavePlanEntry[];
}
