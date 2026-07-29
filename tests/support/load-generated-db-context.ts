import ts from 'typescript';
import vm from 'vm';
import * as entitykit from '../../src';
import type { DbContext } from '../../src';
import type { GeneratedCodeFile } from '../../src/tooling';

/**
 * Compile and evaluate the files `db pull` generated, returning the generated
 * `DbContext` subclass. Used by the round-trip introspection tests to run
 * generated model code against a live database — the same technique
 * db-pull-codegen.test.ts uses for its compile check, factored out so the
 * MySQL, SQLite, and Postgres round-trips share one loader.
 *
 * The generated code imports `entitykit` and, for non-Postgres providers, a
 * provider subpath (`entitykit/mysql`); pass those modules in `extraModules`
 * keyed by specifier. Postgres needs none — it wires through `usePostgres`.
 */
export function loadGeneratedDbContext(
    files: readonly GeneratedCodeFile[],
    contextName: string,
    extraModules: Record<string, unknown> = {},
): { create(): Promise<DbContext> } {
    const modules = new Map(files.map(file => [file.path, transpile(file.contents)]));
    const cache: Map<string, { exports: Record<string, unknown> }> = new Map();

    const load = (filePath: string): Record<string, unknown> => {
        const existing = cache.get(filePath);
        if (existing) {
            return existing.exports;
        }
        const code = modules.get(filePath);
        if (!code) {
            throw new Error(`Generated module '${filePath}' was not found.`);
        }
        const module = { exports: {} as Record<string, unknown> };
        cache.set(filePath, module);
        const fn = vm.runInNewContext(
            `(function (exports, require, module, __filename, __dirname) {\n${code}\n})`,
            { Buffer, process, console },
        ) as (
            exports: Record<string, unknown>,
            require: (specifier: string) => unknown,
            module: { exports: Record<string, unknown> },
            filename: string,
            dirname: string,
        ) => void;
        fn(module.exports, specifier => {
            if (specifier === 'entitykit') {
                return entitykit;
            }
            if (specifier in extraModules) {
                return extraModules[specifier];
            }
            if (specifier.startsWith('./')) {
                return load(`${specifier.slice(2)}.ts`);
            }
            throw new Error(`Unexpected generated module import '${specifier}'.`);
        }, module, filePath, '.');
        return module.exports;
    };

    const contextFile = files.find(file =>
        file.contents.includes(`export class ${contextName} extends DbContext`),
    );
    if (!contextFile) {
        throw new Error(`Generated DbContext '${contextName}' was not found.`);
    }
    return load(contextFile.path)[contextName] as {
        create(): Promise<DbContext>;
    };
}

function transpile(source: string): string {
    return ts.transpileModule(source, {
        compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
}
