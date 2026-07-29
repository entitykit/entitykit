import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.resolve(__dirname, '../..');

export const coreNeutralSourceRoots = [
    'src/diagnostics',
    'src/errors',
    'src/interceptors',
    'src/materialization',
    'src/migrations',
    'src/model',
    'src/query',
    'src/schema',
    'src/sql',
    'src/storage',
    'src/tracking',
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

export function filesContaining(pattern: RegExp): string[] {
    return listSourceFiles('src').filter(file => pattern.test(readSource(file))).sort();
}
