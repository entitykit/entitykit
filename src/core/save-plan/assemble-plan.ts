import type { PersistedEntrySnapshot } from '../../tracking/persisted-entry-snapshot';
import { EntityState } from '../../tracking/entity-state';
import type { SavePlanEntry } from '../save-plan';
import { savePlanExecution } from '../save-plan-execution';
import { oneToOneDisplacementDeletes } from './one-to-one-displacement';

export function assembleSavePlan(
    pending: readonly PersistedEntrySnapshot[],
    entityPlan: readonly SavePlanEntry[],
    manyToManyPlan: readonly SavePlanEntry[],
    relationshipAuthorization: ReadonlyMap<
        object, readonly SavePlanEntry[]
    >,
    outboxPlan: readonly SavePlanEntry[],
): SavePlanEntry[] {
    const earlyDeleteEntities = oneToOneDisplacementDeletes(pending);
    const unlinkPlan = manyToManyPlan.filter(entry =>
        entry.state === EntityState.Deleted);
    const linkPlan = manyToManyPlan.filter(entry =>
        entry.state === EntityState.Added);
    const earlyEntityDeletes = entityPlan.filter(entry =>
        entry.state === EntityState.Deleted &&
        earlyDeleteEntities.has(entry.entity));
    const entityNonDeletes = entityPlan.filter(entry =>
        entry.state !== EntityState.Deleted);
    const authorizedEntityNonDeletes = entityNonDeletes.flatMap(entry => [
        ...(savePlanExecution(entry)?.persistedEntries ?? []).flatMap(
            snapshot => relationshipAuthorization.get(
                snapshot.entry.entity,
            ) ?? [],
        ),
        entry,
    ]);
    const entityDeletes = entityPlan.filter(entry =>
        entry.state === EntityState.Deleted &&
        !earlyDeleteEntities.has(entry.entity));
    return [
        ...unlinkPlan,
        ...earlyEntityDeletes,
        ...authorizedEntityNonDeletes,
        ...linkPlan,
        ...entityDeletes,
        ...outboxPlan,
    ];
}
