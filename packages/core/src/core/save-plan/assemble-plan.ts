import { EntityState } from '../../tracking/entity-state';
import type { SavePlanEntry } from '../save-plan';
import { savePlanExecution } from '../save-plan-execution';

export function assembleSavePlan(
    entityPlan: readonly SavePlanEntry[],
    manyToManyPlan: readonly SavePlanEntry[],
    relationshipAuthorization: ReadonlyMap<
        object, readonly SavePlanEntry[]
    >,
    outboxPlan: readonly SavePlanEntry[],
): SavePlanEntry[] {
    const unlinkPlan = manyToManyPlan.filter(entry =>
        entry.state === EntityState.Deleted);
    const linkPlan = manyToManyPlan.filter(entry =>
        entry.state === EntityState.Added);
    const authorizedEntityPlan = entityPlan.flatMap(entry => [
        ...(savePlanExecution(entry)?.persistedEntries ?? []).flatMap(
            snapshot => relationshipAuthorization.get(
                snapshot.entry.entity,
            ) ?? [],
        ),
        entry,
    ]);
    return [
        ...unlinkPlan,
        ...authorizedEntityPlan,
        ...linkPlan,
        ...outboxPlan,
    ];
}
