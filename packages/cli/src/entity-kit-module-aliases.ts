type ModuleLoader = (request: string) => unknown;

/** Resolve package subpaths while running TypeScript config files from source. */
export function createEntityKitModuleAliases(
    loadModule: ModuleLoader,
    sourceRuntime: boolean,
): Readonly<Record<string, () => unknown>> {
    const load = (sourcePath: string, packagePath: string): () => unknown =>
        () => loadModule(sourceRuntime ? sourcePath : packagePath);
    return {
        entitykit: load('../index', 'entitykit'),
        'entitykit/adapter': load('../adapter', 'entitykit/adapter'),
        'entitykit/cli': load('./entity-kit-config', 'entitykit/cli'),
        'entitykit/migrations': load('../migrations/api', 'entitykit/migrations'),
        'entitykit/mysql': load('../providers/mysql', 'entitykit/mysql'),
        'entitykit/postgres': load('../providers/postgres', 'entitykit/postgres'),
        'entitykit/sqlite': load('../providers/sqlite', 'entitykit/sqlite'),
        'entitykit/tooling': load('../tooling', 'entitykit/tooling'),
    };
}
