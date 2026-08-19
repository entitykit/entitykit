import path from 'node:path';
import { runAtomicFileTransaction } from './atomic-file-transaction';

/** One file written by a rollback-safe filesystem transaction. */
export interface AtomicFileWrite {
    /** Absolute destination path. */ readonly path: string;
    /** Complete UTF-8 file contents. */ readonly contents: string;
    /** Whether this file may replace an existing file. */ readonly replace?: boolean;
}

/** One change in a rollback-safe filesystem transaction. */
export type AtomicFileChange =
    | { readonly kind: 'write' } & AtomicFileWrite
    | { readonly kind: 'remove'; readonly path: string };

/** Write a collection of generated files without leaving a partial result. */
export function writeFilesAtomically(files: readonly AtomicFileWrite[]): void {
    changeFilesAtomically(files.map(file => ({ kind: 'write', ...file })));
}

/** Apply file writes and removals, restoring original files after a failure. */
export function changeFilesAtomically(changes: readonly AtomicFileChange[]): void {
    assertValidChanges(changes);
    runAtomicFileTransaction(changes);
}

/** Resolve an untrusted generated relative path beneath an output directory. */
export function safeGeneratedPath(root: string, relativePath: string): string {
    const resolved = path.resolve(root, relativePath);
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`Generated path '${relativePath}' escapes output directory '${root}'.`);
    }
    return resolved;
}

function assertValidChanges(changes: readonly AtomicFileChange[]): void {
    const destinations: Set<string> = new Set();
    for (const change of changes) {
        if (!path.isAbsolute(change.path)) {
            throw new Error(`Atomic file destination must be absolute: '${change.path}'.`);
        }
        if (destinations.has(change.path)) {
            throw new Error(`Generated output contains duplicate path '${change.path}'.`);
        }
        destinations.add(change.path);
    }
}
