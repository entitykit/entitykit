import type { ChangeTracker } from '../../tracking/change-tracker';
import type { SavePlanEntry } from '../save-plan';
import type { GeneratedKeyPropagation } from '../save-plan-execution';
import type { SaveTimeMutationLog } from '../save-time-mutations';
import { propagateGeneratedKeys } from './generated-key-propagator';
import type { GeneratedValueRecorder } from './generated-value-recorder';
import type { RestorationScope } from '../../restoration-scope';

interface TrackedGeneratedKeyPropagation {
    readonly tracker: ChangeTracker;
    readonly entry: SavePlanEntry;
    readonly persistedValues: Record<string, unknown>;
    readonly persistedBoundValues: Record<string, unknown>;
    readonly mutations: SaveTimeMutationLog;
    readonly recorder: GeneratedValueRecorder;
    readonly scope: RestorationScope;
    readonly propagations?: readonly GeneratedKeyPropagation[];
}

/** Register each propagated identity fact before its dependent setter runs. */
export function applyTrackedGeneratedKeyPropagation(
    options: TrackedGeneratedKeyPropagation,
): void {
    const tracked = options.tracker.entry(options.entry.entity);
    if (!tracked) {
        throw new Error('Generated key propagation requires a tracked entity.');
    }
    const applied = propagateGeneratedKeys(
        options.tracker,
        options.entry,
        options.persistedValues,
        options.persistedBoundValues,
        options.mutations,
        options.scope,
        options.propagations,
        (principal, propertyName) =>
            options.recorder.find(principal, propertyName),
        prepared => {
            options.recorder.register(
                options.entry.entity,
                [prepared],
                options.persistedBoundValues,
            );
        },
    );
    options.recorder.recordApplied(tracked, applied);
}
