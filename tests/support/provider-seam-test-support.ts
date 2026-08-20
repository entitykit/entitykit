import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');

export const coreNeutralSourceRoots = [
    'packages/core/src/diagnostics',
    'packages/core/src/errors',
    'packages/core/src/interceptors',
    'packages/core/src/materialization',
    'packages/core/src/migrations',
    'packages/core/src/model',
    'packages/core/src/query',
    'packages/core/src/schema',
    'packages/core/src/sql',
    'packages/core/src/storage',
    'packages/core/src/tracking',
];

export function readSource(relativePath: string): string {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

export function listSourceFiles(relativeDir: string): string[] {
    const absoluteDir = path.join(repoRoot, relativeDir);
    return fs.readdirSync(absoluteDir, { withFileTypes: true }).flatMap(entry => {
        const relativePath = path.join(relativeDir, entry.name);
        if (entry.isDirectory()) {
            return listSourceFiles(relativePath);
        }

        return entry.isFile() && entry.name.endsWith('.ts') ? [relativePath] : [];
    });
}

/** Every authored source file in the workspace, across all six packages. */
export function listPackageSourceFiles(): string[] {
    return ['core', 'sqlite', 'postgres', 'mysql', 'cli', 'testing']
        .flatMap(name => listSourceFiles(`packages/${name}/src`));
}

export function filesContaining(pattern: RegExp): string[] {
    return listPackageSourceFiles().filter(file => pattern.test(readSource(file))).sort();
}
