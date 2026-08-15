import type { ChangeTracker } from '../../tracking/change-tracker';
import type { GeneratedIdentityRollbackSource } from '../../tracking/generated-identity-rollback-source';
import { captureGeneratedRelationshipRollbackTargets } from '../../tracking/generated-relationship-rollback-scan';
import { runRestorationActions } from '../restoration-failures';

/** Invalidate observed identities before restoring their generated values. */
export function restoreGeneratedValuesAfterFailure(
    tracker: ChangeTracker,
    sources: readonly GeneratedIdentityRollbackSource[],
    restoreValues: () => void,
): void {
    runRestorationActions([
        () => {
            captureGeneratedRelationshipRollbackTargets(
                tracker, sources,
            );
        },
        restoreValues,
    ]);
}
