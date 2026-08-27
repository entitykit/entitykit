import type { FactoryProvider, ModuleMetadata } from '@nestjs/common';
import type { EntityKitDataSource } from '@entitykit/core';

/** Determines who closes the application-scoped data source. */
export type EntityKitDataSourceOwnership = 'module' | 'external';

/** Root configuration for `EntityKitModule`. */
export interface EntityKitModuleOptions<TConfig extends object = Record<string, unknown>> {
    /** The application-scoped provider data source shared by every context. */
    readonly dataSource: EntityKitDataSource<TConfig>;
    /** Use `external` when another component owns data-source shutdown. */
    readonly ownership?: EntityKitDataSourceOwnership;
}

/** Asynchronous root configuration resolved through Nest dependency injection. */
export interface EntityKitModuleAsyncOptions<
    TDependencies extends readonly unknown[] = readonly unknown[],
    TConfig extends object = Record<string, unknown>,
> extends Pick<ModuleMetadata, 'imports'> {
    /** Nest providers passed to `useFactory` in order. */
    readonly inject?: FactoryProvider['inject'];
    /** Create the root EntityKit configuration. */
    readonly useFactory: (
        ...dependencies: TDependencies
    ) => EntityKitModuleOptions<TConfig> | Promise<EntityKitModuleOptions<TConfig>>;
}
