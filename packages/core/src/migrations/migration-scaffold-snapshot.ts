/**
 * The on-disk model-snapshot file: both halves of its serialization boundary.
 *
 * `renderSnapshotSource` writes the sidecar module that pins the model as of a
 * migration; `readModelSnapshot` parses that exact format (plus a couple of
 * legacy shapes) back into a `ModelSnapshot` so the next scaffold can diff
 * against it. `emptySnapshot` is the baseline used when none exists yet. Keeping
 * reader and writer together keeps the two in lock-step.
 */
import fs from 'fs';
import type { ModelSnapshot } from '../model/model-snapshot-types';
import { stringifyModelSnapshot } from './model-snapshot-serialization';

/** Read model snapshot. */ export function readModelSnapshot(snapshotPath: string): ModelSnapshot | undefined {
    if (!fs.existsSync(snapshotPath)) {
        return undefined;
    }

    const source = fs.readFileSync(snapshotPath, 'utf8');
    const exportDefault = /export\s+default\s+([\s\S]*?)\s+satisfies\s+ModelSnapshot\s*;/.exec(source);
    if (exportDefault) {
        return JSON.parse(exportDefault[1]) as ModelSnapshot;
    }

    const constSnapshot = /const\s+snapshot\s*:\s*ModelSnapshot\s*=\s*([\s\S]*?);\s*export\s+default\s+snapshot\s*;/m.exec(source);
    if (constSnapshot) {
        return JSON.parse(constSnapshot[1]) as ModelSnapshot;
    }

    return JSON.parse(source) as ModelSnapshot;
}

/** Render snapshot source. */ export function renderSnapshotSource(snapshot: ModelSnapshot): string {
    return [
        'import type { ModelSnapshot } from "entitykit/migrations";',
        '',
        `export default ${stringifyModelSnapshot(snapshot)} satisfies ModelSnapshot;`,
        '',
    ].join('\n');
}

export function emptySnapshot(): ModelSnapshot {
    return { formatVersion: 1, entities: [] };
}
