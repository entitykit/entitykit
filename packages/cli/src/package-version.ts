import fs from 'node:fs';
import path from 'node:path';

/**
 * Manifest names that own the CLI's own version.
 *
 * The walk stops at the first enclosing `package.json` carrying one of these
 * names, so it must accept both the single-package name used today and the name
 * the CLI takes after the monorepo cutover. `'entitykit'` is dropped once the
 * CLI ships from its own package.
 */
const packageNames: ReadonlySet<string> = new Set(['entitykit', '@entitykit/cli']);

/** Read the package version from the source or installed package root. */
export function entityKitPackageVersion(): string {
    let directory = path.dirname(__filename);
    while (directory !== path.dirname(directory)) {
        const manifestPath = path.join(directory, 'package.json');
        if (fs.existsSync(manifestPath)) {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as {
                readonly name?: unknown;
                readonly version?: unknown;
            };
            if (
                typeof manifest.name === 'string'
                && packageNames.has(manifest.name)
                && typeof manifest.version === 'string'
            ) {
                return manifest.version;
            }
        }
        directory = path.dirname(directory);
    }
    throw new Error('Could not find EntityKit package metadata.');
}
