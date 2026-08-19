import type { ModelSnapshot } from '../model/model-snapshot-types';

/**
 * What migration scaffolding needs from a context: the model as it stands now,
 * to diff against the snapshot on disk.
 *
 * Named as a role rather than taking `DbContext` so the migrations layer does
 * not depend on core. `DbContext` satisfies it structurally, and a caller with
 * a snapshot from somewhere else — a test, a codegen step, a second model —
 * can scaffold without constructing a context.
 */
export interface ModelSnapshotSource {
    /** Create model snapshot. */ createModelSnapshot(): ModelSnapshot;
}
