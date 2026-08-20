type ModuleLoader = (request: string) => unknown;

/** Resolve package subpaths while running TypeScript config files from source. */
export function createEntityKitModuleAliases(
    loadModule: ModuleLoader,
    sourceRuntime: boolean,
): Readonly<Record<string, () => unknown>> {
    const load = (sourcePath: string, packagePath: string): () => unknown =>
        () => loadModule(sourceRuntime ? sourcePath : packagePath);
    return {
        entitykit: load('../../core/src/index', 'entitykit'),
        'entitykit/adapter': load('../../core/src/adapter', 'entitykit/adapter'),
        'entitykit/cli': load('../../core/src/entity-kit-config', 'entitykit/cli'),
        'entitykit/migrations': load('../../core/src/migrations/api', 'entitykit/migrations'),
        'entitykit/mysql': load('../../mysql/src/index', 'entitykit/mysql'),
        'entitykit/postgres': load('../../postgres/src/index', 'entitykit/postgres'),
        'entitykit/sqlite': load('../../sqlite/src/index', 'entitykit/sqlite'),
        'entitykit/tooling': load('../../core/src/tooling', 'entitykit/tooling'),
    };
}
