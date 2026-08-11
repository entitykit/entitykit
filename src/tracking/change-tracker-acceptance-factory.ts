import { ChangeTrackerAcceptance } from './change-tracker-acceptance';
import type { ChangeTrackerRegistry } from './change-tracker-registry';
import type { SaveMutationGuard } from './save-mutation-guard';

export function createChangeTrackerAcceptance(
    registry: ChangeTrackerRegistry,
    saveGuard: SaveMutationGuard,
): ChangeTrackerAcceptance {
    return new ChangeTrackerAcceptance(
        () => registry.entries(),
        entry => registry.has(entry),
        registry.identities,
        entity => {
            registry.detach(entity);
        },
        entry => {
            registry.restore(entry);
        },
        (entries, identities) => saveGuard.defer(entries, identities),
        () => {
            registry.assertInvariant();
        },
    );
}
