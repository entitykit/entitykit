type ModuleLoader = (request: string) => unknown;

/** Resolve package subpaths while running TypeScript config files from source. */
export function createEntityKitModuleAliases(
    loadModule: ModuleLoader,
    sourceRuntime: boolean,
): Readonly<Record<string, () => unknown>> {
    const load = (sourcePath: string, packagePath: string): () => unknown =>
        () => loadModule(sourceRuntime ? sourcePath : packagePath);
    return {
        '@entitykit/core': load('../../core/src/index', '@entitykit/core'),
        '@entitykit/core/adapter': load('../../core/src/adapter', '@entitykit/core/adapter'),
        '@entitykit/core/migrations': load('../../core/src/migrations/api', '@entitykit/core/migrations'),
        '@entitykit/core/tooling': load('../../core/src/tooling', '@entitykit/core/tooling'),
        // The definition API lives in core, but `@entitykit/cli` re-exports it,
        // so a config file that imports it from the CLI still resolves.
        '@entitykit/cli': load('../../core/src/entity-kit-config', '@entitykit/cli'),
        '@entitykit/mysql': load('../../mysql/src/index', '@entitykit/mysql'),
        '@entitykit/postgres': load('../../postgres/src/index', '@entitykit/postgres'),
        '@entitykit/sqlite': load('../../sqlite/src/index', '@entitykit/sqlite'),
    };
}
