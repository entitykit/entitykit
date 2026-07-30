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

export function createRuntimeDependencyGraph(root: string): RuntimeDependencyGraph {
    const sourceRoot = path.join(root, 'src');
    const files = collectTypeScriptFiles(sourceRoot);
    const knownFiles = new Set(files);
    const graph: Map<string, readonly string[]> = new Map();

    for (const file of files) {
        const source = fs.readFileSync(file, 'utf8');
        const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
        const dependencies = parsed.statements
            .map(runtimeModuleSpecifier)
            .filter((specifier): specifier is string => specifier !== undefined)
            .map(specifier => resolveSourceModule(file, specifier, knownFiles))
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

function resolveSourceModule(
    source: string,
    specifier: string,
    files: ReadonlySet<string>,
): string | undefined {
    if (!specifier.startsWith('.')) {
        return undefined;
    }

    const base = path.resolve(path.dirname(source), specifier.replace(/\.js$/, ''));
    return [`${base}.ts`, path.join(base, 'index.ts')]
        .find(candidate => files.has(candidate));
}

function relativeModule(root: string, file: string): string {
    return path.relative(root, file).split(path.sep).join('/');
}
