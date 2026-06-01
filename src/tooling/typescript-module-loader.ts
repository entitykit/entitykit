import { createRequire } from 'node:module';
import fs from 'node:fs';
import Module from 'node:module';
import path from 'node:path';
import type * as TypeScript from 'typescript';
import { commonJsImportMetaTransformer, commonJsTranspileFileName } from './common-js-import-meta-transformer';

const loadModule = createRequire(__filename);
type ModuleAlias = () => unknown;

/**
 * Load a TypeScript CommonJS module and its relative TypeScript dependencies.
 *
 * The compiler stays lazy so JavaScript-only CLI projects do not pay its
 * startup cost. Each root load owns a module cache, which preserves CommonJS
 * cycle and singleton semantics without installing a process-global hook.
 */
export function loadTypeScriptModule(
    filePath: string,
    aliases: Readonly<Partial<Record<string, ModuleAlias>>> = {},
): unknown {
    const typescript = loadModule('typescript') as typeof TypeScript;
    const cache: Map<string, NodeJS.Module> = new Map();

    const load = (candidate: string, parent: NodeJS.Module): unknown => {
        const resolved = path.resolve(candidate);
        const cached = cache.get(resolved);
        if (cached) {
            return cached.exports as unknown;
        }

        const loaded = new Module(resolved, parent);
        loaded.filename = resolved;
        loaded.paths = nodeModulePaths(path.dirname(resolved));
        cache.set(resolved, loaded);

        const source = fs.readFileSync(resolved, 'utf8');
        const output = typescript.transpileModule(source, {
            compilerOptions: {
                module: typescript.ModuleKind.CommonJS,
                moduleResolution: typescript.ModuleResolutionKind.Node10,
                target: typescript.ScriptTarget.ES2022,
                esModuleInterop: true,
                inlineSourceMap: true,
                inlineSources: true,
            },
            fileName: commonJsTranspileFileName(resolved),
            transformers: {
                before: [commonJsImportMetaTransformer(typescript)],
            },
        }).outputText;

        const originalRequire = loaded.require.bind(loaded);
        loaded.require = (request: string): unknown => {
            const alias = aliases[request];
            if (alias) {
                try {
                    return originalRequire(request) as unknown;
                } catch (error) {
                    if (!isMissingRequestedModule(error, request)) {
                        throw error;
                    }
                    return alias();
                }
            }

            const dependency = resolveTypeScriptDependency(request, resolved);
            return dependency
                ? load(dependency, loaded)
                : originalRequire(request) as unknown;
        };

        try {
            compile(loaded, output, resolved);
            loaded.loaded = true;
            return loaded.exports as unknown;
        } catch (error) {
            cache.delete(resolved);
            throw error;
        }
    };

    return load(filePath, loadModule.main ?? module);
}

function isMissingRequestedModule(error: unknown, request: string): boolean {
    const missing = error as { readonly code?: string; readonly message?: string };
    return missing.code === 'MODULE_NOT_FOUND'
    && Boolean(missing.message?.includes(`'${request}'`));
}

function resolveTypeScriptDependency(
    request: string,
    parentPath: string,
): string | undefined {
    if (!request.startsWith('.') && !path.isAbsolute(request)) {
        return undefined;
    }

    const requestedPath = path.resolve(path.dirname(parentPath), request);
    const extension = path.extname(requestedPath).toLowerCase();
    const candidates = extension
        ? sourceCandidatesForExplicitExtension(requestedPath, extension)
        : [
            `${requestedPath}.ts`,
            `${requestedPath}.tsx`,
            `${requestedPath}.cts`,
            `${requestedPath}.mts`,
            path.join(requestedPath, 'index.ts'),
            path.join(requestedPath, 'index.tsx'),
            path.join(requestedPath, 'index.cts'),
            path.join(requestedPath, 'index.mts'),
        ];

    return candidates.find(candidate =>
        fs.existsSync(candidate) && fs.statSync(candidate).isFile(),
    );
}

function sourceCandidatesForExplicitExtension(
    requestedPath: string,
    extension: string,
): readonly string[] {
    if (['.ts', '.tsx', '.cts', '.mts'].includes(extension)) {
        return [requestedPath];
    }
    const sourceExtension = extension === '.js'
        ? '.ts'
        : extension === '.cjs'
            ? '.cts'
            : extension === '.mjs'
                ? '.mts'
                : undefined;
    return sourceExtension
        ? [requestedPath, requestedPath.slice(0, -extension.length) + sourceExtension]
        : [];
}

function nodeModulePaths(directory: string): string[] {
    return (Module as unknown as {
        _nodeModulePaths(value: string): string[];
    })._nodeModulePaths(directory);
}

function compile(loaded: Module, source: string, filePath: string): void {
    (loaded as unknown as {
        _compile(code: string, filename: string): void;
    })._compile(source, filePath);
}
