import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import vm from 'vm';
import * as entitykit from '../../src';
import { contextMigrations, type ModelSnapshot } from '../../src/migrations/api';
import { createManagedTempDirectory } from '../support/managed-temp-directory';

export function createProject(): string {
    const cwd = createManagedTempDirectory('entitykit-db-pull-integration-');
    fs.writeFileSync(path.join(cwd, 'entitykit.config.ts'), `
    import { postgresProviderServices } from "entitykit/postgres";
    class TestContext { static create() { return new TestContext(); } }
    export default {
      context: TestContext,
      provider: postgresProviderServices,
      connectionString: process.env.DATABASE_URL
    };
  `);
    return cwd;
}

export function compileGeneratedDirectory(generatedDir: string): readonly string[] {
    const files = fs.readdirSync(generatedDir)
        .filter(file => file.endsWith('.ts'))
        .map(file => path.join(generatedDir, file));
    const options: ts.CompilerOptions = {
        baseUrl: generatedDir,
        declaration: false,
        esModuleInterop: true,
        forceConsistentCasingInFileNames: true,
        module: ts.ModuleKind.CommonJS,
        moduleResolution: ts.ModuleResolutionKind.Node10,
        noEmit: true,
        noImplicitOverride: true,
        paths: {
            entitykit: [path.resolve(__dirname, '../../src/index.ts')],
        },
        skipLibCheck: true,
        strict: true,
        target: ts.ScriptTarget.ES2022,
        types: ['node'],
    };
    const program = ts.createProgram(files, options);
    return ts.getPreEmitDiagnostics(program)
        .map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
}

export async function createGeneratedModelSnapshot(
    generatedDir: string,
    contextFileName: string,
): Promise<ModelSnapshot> {
    const modules = new Map(fs.readdirSync(generatedDir)
        .filter(file => file.endsWith('.ts'))
        .map(file => [
            file,
            transpileGeneratedFile(fs.readFileSync(path.join(generatedDir, file), 'utf8')),
        ]));
    const cache: Map<string, { exports: Record<string, unknown> }> = new Map();

    const load = (fileName: string): Record<string, unknown> => {
        const existing = cache.get(fileName);
        if (existing) {
            return existing.exports;
        }

        const code = modules.get(fileName);
        if (!code) {
            throw new Error(`Generated module '${fileName}' was not found.`);
        }

        const module = { exports: {} as Record<string, unknown> };
        cache.set(fileName, module);
        const fn = vm.runInNewContext(
            `(function (exports, require, module, __filename, __dirname) {\n${code}\n})`,
            { Buffer, process },
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
        }, module, fileName, generatedDir);
        return module.exports;
    };

    const contextModule = load(contextFileName);
    const contextType = Object.values(contextModule).find((value): value is {
        create(): Promise<entitykit.DbContext>;
    } => typeof value === 'function' && 'create' in value);
    if (!contextType) {
        throw new Error(`Generated context module '${contextFileName}' has no context export.`);
    }
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
