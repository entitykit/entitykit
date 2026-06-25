import type { ModelSnapshot, SequenceSnapshot } from '../model/model-snapshot-types';
import type { MigrationSequenceDefinition } from './migration-builder';
import type { ModelDiffOperation } from './model-diff-operations';

export function diffSequences(
    from: ModelSnapshot,
    to: ModelSnapshot,
): ModelDiffOperation[] {
    const operations: ModelDiffOperation[] = [];
    const previous = new Map((from.sequences ?? []).map(sequence => [key(sequence), sequence]));
    const current = new Map((to.sequences ?? []).map(sequence => [key(sequence), sequence]));
    for (const sequence of from.sequences ?? []) {
        if (!current.has(key(sequence))) {
            operations.push({ kind: 'dropSequence', sequence: definition(sequence) });
        }
    }
    for (const sequence of to.sequences ?? []) {
        const old = previous.get(key(sequence));
        if (!old) {
            operations.push({ kind: 'createSequence', sequence: definition(sequence) });
        } else if (JSON.stringify(old) !== JSON.stringify(sequence)) {
            operations.push({
                kind: 'alterSequence',
                sequence: definition(sequence),
                previous: definition(old),
            });
        }
    }
    return operations;
}

function key(sequence: SequenceSnapshot): string {
    return `${sequence.schemaName ?? ''}.${sequence.name}`;
}

function definition(sequence: SequenceSnapshot): MigrationSequenceDefinition {
    return { ...sequence };
}
