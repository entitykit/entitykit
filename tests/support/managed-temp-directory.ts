import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const managedDirectories: string[] = [];
const managedSuiteDirectories: string[] = [];

afterEach(() => {
    removeManagedDirectories(managedDirectories);
});

afterAll(() => {
    removeManagedDirectories(managedSuiteDirectories);
});

/** Create a test directory that is removed even when its test fails. */
export function createManagedTempDirectory(prefix: string): string {
    const directory = createTempDirectory(prefix);
    managedDirectories.push(directory);
    return directory;
}

/** Create a directory shared by a suite and remove it after the suite finishes. */
export function createManagedSuiteTempDirectory(prefix: string): string {
    const directory = createTempDirectory(prefix);
    managedSuiteDirectories.push(directory);
    return directory;
}

function createTempDirectory(prefix: string): string {
    return mkdtempSync(join(tmpdir(), prefix));
}

function removeManagedDirectories(directories: string[]): void {
    for (const directory of directories.splice(0)) {
        rmSync(directory, { recursive: true, force: true });
    }
}
