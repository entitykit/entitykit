import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { runtimeModuleSpecifier } from './runtime-module-specifier';

export type RuntimeDependencyGraph = ReadonlyMap<string, readonly string[]>;

interface SourceDirectoryEntry {
    readonly name: string;
    isDirectory(): boolean;
    isFile(): boolean;
}

const packageNames = [
    'core', 'sqlite', 'postgres', 'mysql', 'cli', 'testing', 'nestjs',
] as const;

/**
 * Public entry each package specifier resolves to, relative to the repository.
 *
 * Cross-package imports are package specifiers now, so a graph that only
 * followed relative paths would stop at every package boundary and call the
 * result acyclic. Resolving each specifier to the entry file it names keeps one
 * graph over the whole workspace, exactly as strong as it was before the split.
 */
const packageEntries: Readonly<Partial<Record<string, string>>> = {
    '@entitykit/core': 'packages/core/src/index.ts',
    '@entitykit/core/adapter': 'packages/core/src/adapter/index.ts',
    '@entitykit/core/experimental': 'packages/core/src/experimental/index.ts',
    '@entitykit/core/migrations': 'packages/core/src/migrations/api.ts',
    '@entitykit/core/tooling': 'packages/core/src/tooling/index.ts',
    '@entitykit/cli': 'packages/cli/src/api.ts',
    '@entitykit/mysql': 'packages/mysql/src/index.ts',
    '@entitykit/nestjs': 'packages/nestjs/src/index.ts',
    '@entitykit/postgres': 'packages/postgres/src/index.ts',
    '@entitykit/sqlite': 'packages/sqlite/src/index.ts',
    '@entitykit/testing': 'packages/testing/src/index.ts',
};

export function createRuntimeDependencyGraph(root: string): RuntimeDependencyGraph {
    const files = packageNames.flatMap(name =>
        collectTypeScriptFiles(path.join(root, 'packages', name, 'src')));
    const knownFiles = new Set(files);
    const graph: Map<string, readonly string[]> = new Map();

    for (const file of files) {
        const source = fs.readFileSync(file, 'utf8');
        const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
        const dependencies = parsed.statements
            .map(runtimeModuleSpecifier)
            .filter((specifier): specifier is string => specifier !== undefined)
            .map(specifier => resolveModule(root, file, specifier, knownFiles))
            .filter((target): target is string => target !== undefined)
            .map(target => relativeModule(root, target));
        graph.set(relativeModule(root, file), [...new Set(dependencies)].sort());
    }

    return graph;
}

function collectTypeScriptFiles(directory: string): string[] {
    const entries = fs.readdirSync(directory, { withFileTypes: true }) as SourceDirectoryEntry[];
    return entries
        .flatMap(entry => {
            const target = path.join(directory, entry.name);
            if (entry.isDirectory()) {
                return collectTypeScriptFiles(target);
            }
            return entry.isFile() && entry.name.endsWith('.ts') ? [target] : [];
        })
        .sort();
}

function resolveModule(
    root: string,
    source: string,
    specifier: string,
    files: ReadonlySet<string>,
): string | undefined {
    if (!specifier.startsWith('.')) {
        const entry = packageEntries[specifier];
        return entry === undefined ? undefined : path.join(root, entry);
    }

    const base = path.resolve(path.dirname(source), specifier.replace(/\.js$/, ''));
    return [`${base}.ts`, path.join(base, 'index.ts')]
        .find(candidate => files.has(candidate));
}

function relativeModule(root: string, file: string): string {
    return path.relative(root, file).split(path.sep).join('/');
}
