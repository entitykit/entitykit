import type { SavePlanEntry } from '../save-plan';
import { savePlanExecution } from '../save-plan-execution';
import type { ChangeTracker } from '../../tracking/change-tracker';
import type { EntityEntry } from '../../tracking/entity-entry';

export function reconcileSavePlanChanges(
    plan: readonly SavePlanEntry[],
    tracker: ChangeTracker,
): void {
    const seen: Set<EntityEntry<object>> = new Set();
    for (const planEntry of plan) {
        for (const snapshot of savePlanExecution(planEntry)?.persistedEntries ?? []) {
            const entry = snapshot.entry;
            if (seen.has(entry) || tracker.entry(entry.entity) !== entry) {
                continue;
            }
            seen.add(entry);
            try {
                entry.detectChanges();
            } catch {
                // The provider commit already succeeded; normal detection can retry later.
            }
        }
    }
}
