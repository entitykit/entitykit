import fs from 'node:fs';
import path from 'node:path';

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
            if (manifest.name === 'entitykit' && typeof manifest.version === 'string') {
                return manifest.version;
            }
        }
        directory = path.dirname(directory);
    }
    throw new Error('Could not find EntityKit package metadata.');
}
