import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { AtomicFileChange } from './atomic-file-writer';

interface StagedFileChange {
    readonly change: AtomicFileChange;
    readonly temporaryPath: string;
    readonly backupPath: string;
    readonly existed: boolean;
    backedUp: boolean;
    committed: boolean;
}

/** Stage, commit, and recover one prevalidated file transaction. */
export function runAtomicFileTransaction(changes: readonly AtomicFileChange[]): void {
    const transaction = randomUUID();
    const staged = changes.map((change, index): StagedFileChange => ({
        change,
        temporaryPath: `${change.path}.entitykit-${transaction}-${String(index)}.tmp`,
        backupPath: `${change.path}.entitykit-${transaction}-${String(index)}.bak`,
        existed: fs.existsSync(change.path),
        backedUp: false,
        committed: false,
    }));
    preflight(staged);
    try {
        stageWrites(staged);
        commitChanges(staged);
    } catch (error) {
        const rollbackErrors = rollback(staged);
        if (rollbackErrors.length > 0) {
            throw new AggregateError(
                [error, ...rollbackErrors],
                'File transaction failed and could not be completely rolled back.',
                { cause: error },
            );
        }
        throw error;
    }
    cleanup(staged);
}

function preflight(staged: readonly StagedFileChange[]): void {
    for (const file of staged) {
        if (file.change.kind === 'write' && file.existed && !file.change.replace) {
            throw new Error(`Refusing to overwrite existing file '${file.change.path}'. Pass --force to replace generated files.`);
        }
        if (file.existed && !fs.statSync(file.change.path).isFile()) {
            throw new Error(`Atomic file destination is not a regular file: '${file.change.path}'.`);
        }
        if (file.change.kind === 'remove' && !file.existed) {
            throw new Error(`Cannot remove missing file '${file.change.path}'.`);
        }
    }
}

function stageWrites(staged: readonly StagedFileChange[]): void {
    for (const file of staged) {
        if (file.change.kind !== 'write') {
            continue;
        }
        fs.mkdirSync(path.dirname(file.change.path), { recursive: true });
        fs.writeFileSync(file.temporaryPath, file.change.contents, { encoding: 'utf8', flag: 'wx' });
        if (file.existed) {
            fs.chmodSync(file.temporaryPath, fs.statSync(file.change.path).mode);
        }
    }
}

function commitChanges(staged: readonly StagedFileChange[]): void {
    for (const file of staged) {
        if (file.existed) {
            fs.renameSync(file.change.path, file.backupPath);
            file.backedUp = true;
        }
        if (file.change.kind === 'remove') {
            file.committed = true;
        } else if (!file.existed && !file.change.replace) {
            fs.linkSync(file.temporaryPath, file.change.path);
            file.committed = true;
        } else {
            fs.renameSync(file.temporaryPath, file.change.path);
            file.committed = true;
        }
    }
}

function rollback(staged: readonly StagedFileChange[]): Error[] {
    const errors: Error[] = [];
    for (const file of [...staged].reverse()) {
        if (file.committed && file.change.kind === 'write') {
            attempt(() => {
                removeIfExists(file.change.path);
            }, errors);
        }
        if (file.backedUp) {
            attempt(() => {
                fs.renameSync(file.backupPath, file.change.path);
            }, errors);
        }
        attempt(() => {
            removeIfExists(file.temporaryPath);
        }, errors);
    }
    return errors;
}

function cleanup(staged: readonly StagedFileChange[]): void {
    for (const file of staged) {
        try {
            removeIfExists(file.temporaryPath);
            removeIfExists(file.backupPath);
        } catch {
            // The intended state is committed. Retaining a recovery artifact is safer than rollback.
        }
    }
}

function attempt(work: () => void, errors: Error[]): void {
    try {
        work();
    } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
    }
}

function removeIfExists(filePath: string): void {
    try {
        fs.unlinkSync(filePath);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw error;
        }
    }
}
