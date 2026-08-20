import fs from 'node:fs';
import path from 'node:path';

interface TypeScriptConfig {
    readonly extends?: string;
    readonly compilerOptions?: {
        readonly types?: readonly string[];
        readonly paths?: Readonly<Record<string, readonly string[]>>;
        readonly composite?: boolean;
        readonly declaration?: boolean;
        readonly rootDir?: string;
        readonly outDir?: string;
        readonly module?: string;
        readonly moduleResolution?: string;
    };
    readonly include?: readonly string[];
    readonly exclude?: readonly string[];
    readonly references?: ReadonlyArray<{ readonly path: string }>;
}

const packageNames = ['core', 'sqlite', 'postgres', 'mysql', 'cli', 'testing'] as const;

function readConfig(...segments: string[]): TypeScriptConfig {
    return JSON.parse(fs.readFileSync(
        path.join(process.cwd(), ...segments),
        'utf8',
    )) as TypeScriptConfig;
}

describe('TypeScript config', () => {
    it('includes Jest and Node globals explicitly for CI typecheck', () => {
        const tsconfig = readConfig('tsconfig.json');

        expect(tsconfig.compilerOptions?.types).toEqual(expect.arrayContaining(['jest', 'node']));
    });

    it('typechecks every package source together with the tests that drive it', () => {
        const tsconfig = readConfig('tsconfig.json');

        expect(tsconfig.include).toEqual([
            'dogfood/**/*.ts',
            'packages/*/src/**/*.ts',
            'tests/**/*.ts',
        ]);
        expect(tsconfig.exclude).toEqual(['tests/fixtures/package-consumer']);
    });

    it('resolves every workspace package specifier to package sources', () => {
        // The typecheck profile never reads `dist`, so the suite and the editor
        // see the same files the tests execute.
        const paths = readConfig('tsconfig.json').compilerOptions?.paths ?? {};

        expect(paths).toEqual({
            '@entitykit/core': ['./packages/core/src/index.ts'],
            '@entitykit/core/adapter': ['./packages/core/src/adapter/index.ts'],
            '@entitykit/core/experimental': ['./packages/core/src/experimental/index.ts'],
            '@entitykit/core/migrations': ['./packages/core/src/migrations/api.ts'],
            '@entitykit/core/tooling': ['./packages/core/src/tooling/index.ts'],
            '@entitykit/cli': ['./packages/cli/src/api.ts'],
            '@entitykit/mysql': ['./packages/mysql/src/index.ts'],
            '@entitykit/postgres': ['./packages/postgres/src/index.ts'],
            '@entitykit/sqlite': ['./packages/sqlite/src/index.ts'],
            '@entitykit/testing': ['./packages/testing/src/index.ts'],
        });
    });

    it('shares one composite build profile that honours package exports', () => {
        const base = readConfig('tsconfig.base.json').compilerOptions;

        expect(base?.composite).toBe(true);
        expect(base?.declaration).toBe(true);
        // Node16 resolution is what lets a package reach a sibling's `./adapter`
        // subpath through its published `exports` map instead of a deep path.
        expect(base?.module).toBe('Node16');
        expect(base?.moduleResolution).toBe('Node16');
    });

    it('gives every package its own emit, wired by project references', () => {
        for (const name of packageNames) {
            const config = readConfig('packages', name, 'tsconfig.json');

            expect(`${name}:${String(config.extends)}`).toBe(`${name}:../../tsconfig.base.json`);
            expect(`${name}:${String(config.compilerOptions?.rootDir)}`).toBe(`${name}:src`);
            expect(`${name}:${String(config.compilerOptions?.outDir)}`).toBe(`${name}:dist`);
            expect(`${name}:${JSON.stringify(config.include)}`)
                .toBe(`${name}:["src/**/*.ts"]`);
            expect(`${name}:${JSON.stringify(config.references ?? [])}`).toBe(
                name === 'core'
                    ? `${name}:[]`
                    : `${name}:[{"path":"../core"}]`,
            );
        }
    });

    it('has no repository-wide build config left to drift', () => {
        // Emit belongs to the per-package projects now; a root build config
        // would compile the packages a second time under different options.
        expect(fs.existsSync(path.join(process.cwd(), 'tsconfig.build.json'))).toBe(false);
    });
});
