import path from 'node:path';
import ts from 'typescript';
import { createRuntimeDependencyGraph } from './runtime-dependency-graph';
import { findRuntimeDependencyCycles } from './runtime-dependency-cycles';
import { runtimeModuleSpecifier } from './runtime-module-specifier';

const root = path.resolve(__dirname, '../..');

describe('runtime dependency cycles', () => {
    it('keeps the complete source runtime graph acyclic', () => {
        const graph = createRuntimeDependencyGraph(root);
        expect(findRuntimeDependencyCycles(graph)).toEqual([]);
    });

    it('finds direct, nested, and self cycles deterministically', () => {
        const graph = new Map([
            ['src/z.ts', ['src/a.ts']],
            ['src/a.ts', ['src/z.ts']],
            ['src/b.ts', ['src/c.ts']],
            ['src/c.ts', ['src/d.ts']],
            ['src/d.ts', ['src/b.ts']],
            ['src/self.ts', ['src/self.ts']],
        ]);

        expect(findRuntimeDependencyCycles(graph)).toEqual([
            ['src/a.ts', 'src/z.ts', 'src/a.ts'],
            ['src/b.ts', 'src/c.ts', 'src/d.ts', 'src/b.ts'],
            ['src/self.ts', 'src/self.ts'],
        ]);
    });

    it('distinguishes runtime imports from type-only imports', () => {
        const source = [
            'import type { Shape } from "./shape";',
            'import { type OtherShape } from "./other-shape";',
            'import { type Config, create } from "./create";',
            'export type { Result } from "./result";',
            'export { type Value, run } from "./run";',
            'import "./register";',
        ].join('\n');
        const parsed = ts.createSourceFile('module.ts', source, ts.ScriptTarget.Latest, true);

        expect(parsed.statements
            .map(runtimeModuleSpecifier)
            .filter((specifier): specifier is string => specifier !== undefined))
            .toEqual(['./create', './run', './register']);
    });
});
