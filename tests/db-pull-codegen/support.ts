import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as entitykit from '../../packages/core/src';
import { generateDbPullCode, type DatabaseSchemaSnapshot } from '../../packages/core/src/tooling';
import { contextMigrations, type ModelSnapshot } from '../../packages/core/src/migrations/api';
import { createManagedTempDirectory } from '../support/managed-temp-directory';

export function compileGeneratedFiles(snapshot: DatabaseSchemaSnapshot): readonly string[] {
    const cwd = createManagedTempDirectory('entitykit-db-pull-compile-');
    const files = generateDbPullCode(snapshot, { contextName: 'PulledDbContext' });
    for (const file of files) {
        fs.writeFileSync(path.join(cwd, file.path), file.contents, 'utf8');
    }

    const options: ts.CompilerOptions = {
        baseUrl: cwd,
        declaration: false,
        esModuleInterop: true,
        forceConsistentCasingInFileNames: true,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.Node10,
        noEmit: true,
        noImplicitOverride: true,
        paths: {
            entitykit: [path.resolve(__dirname, '../../packages/core/src/index.ts')],
        },
        skipLibCheck: true,
        strict: true,
        target: ts.ScriptTarget.ES2022,
        types: ['node'],
    };
    const program = ts.createProgram(files.map(file => path.join(cwd, file.path)), options);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    fs.rmSync(cwd, { recursive: true, force: true });
    return diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
}

export async function createGeneratedModelSnapshot(snapshot: DatabaseSchemaSnapshot): Promise<ModelSnapshot> {
    const files = generateDbPullCode(snapshot, {
        contextName: 'PulledDbContext',
        connectionStringExpression: JSON.stringify('postgres://entitykit.invalid/entitykit'),
    });
    const modules = new Map(files.map(file => [file.path, transpileGeneratedFile(file.contents)]));
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
            { Buffer },
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
            if (specifier.startsWith('./')) {
                return load(`${specifier.slice(2)}.ts`);
            }
            throw new Error(`Unexpected generated module import '${specifier}'.`);
        }, module, filePath, '.');
        return module.exports;
    };

    const contextModule = load('pulled-db-context.ts');
    const contextType = contextModule.PulledDbContext as { create(): Promise<entitykit.DbContext> };
    const context = await contextType.create();
    return contextMigrations(context).createModelSnapshot();
}

function transpileGeneratedFile(source: string): string {
    return ts.transpileModule(source, {
        compilerOptions: {
            esModuleInterop: true,
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
        },
    }).outputText;
}
