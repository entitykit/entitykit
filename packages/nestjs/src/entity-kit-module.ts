import {
    Module,
    type DynamicModule,
    type Provider,
} from '@nestjs/common';
import type { EntityKitDataSource } from '@entitykit/core';
import { EntityKitContextRunner } from './entity-kit-context-runner.js';
import type { EntityKitContextType } from './entity-kit-context-type.js';
import { EntityKitDataSourceLifecycle } from './entity-kit-data-source-lifecycle.js';
import type {
    EntityKitModuleAsyncOptions,
    EntityKitModuleOptions,
} from './entity-kit-module-options.js';
import {
    getEntityKitContextRunnerToken,
    getEntityKitDataSourceToken,
} from './entity-kit-provider-tokens.js';

const moduleOptionsToken = Symbol('EntityKitModuleOptions');
const lifecycleToken = Symbol('EntityKitDataSourceLifecycle');

/** Nest module for one application-scoped data source and safe context runners. */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class -- Nest modules are class tokens.
export class EntityKitModule {
    /** Register a ready application-scoped data source globally. */
    public static forRoot<TConfig extends object>(
        options: EntityKitModuleOptions<TConfig>,
    ): DynamicModule {
        return this.rootModule({
            provide: moduleOptionsToken,
            useValue: options,
        });
    }

    /** Resolve the application-scoped data source through Nest injection. */
    public static forRootAsync<
        TDependencies extends readonly unknown[],
        TConfig extends object,
    >(options: EntityKitModuleAsyncOptions<TDependencies, TConfig>): DynamicModule {
        return this.rootModule({
            provide: moduleOptionsToken,
            inject: options.inject,
            useFactory: options.useFactory,
        }, options.imports);
    }

    /** Register injectable runners for the listed context classes. */
    public static forFeature(
        contextTypes: readonly EntityKitContextType[],
    ): DynamicModule {
        const providers = contextTypes.map(contextType => ({
            provide: getEntityKitContextRunnerToken(contextType),
            inject: [getEntityKitDataSourceToken()],
            useFactory: (dataSource: EntityKitDataSource) =>
                new EntityKitContextRunner(dataSource, contextType),
        }));
        return { module: EntityKitModule, providers, exports: providers };
    }

    private static rootModule(
        optionsProvider: Provider,
        imports: DynamicModule['imports'] = [],
    ): DynamicModule {
        const dataSourceProvider: Provider = {
            provide: getEntityKitDataSourceToken(),
            inject: [moduleOptionsToken],
            useFactory: (options: EntityKitModuleOptions) => options.dataSource,
        };
        const lifecycleProvider: Provider = {
            provide: lifecycleToken,
            inject: [moduleOptionsToken, getEntityKitDataSourceToken()],
            useFactory: (
                options: EntityKitModuleOptions,
                dataSource: EntityKitDataSource,
            ) => new EntityKitDataSourceLifecycle(
                dataSource,
                options.ownership ?? 'module',
            ),
        };
        return {
            global: true,
            module: EntityKitModule,
            imports,
            providers: [optionsProvider, dataSourceProvider, lifecycleProvider],
            exports: [dataSourceProvider],
        };
    }
}

Module({})(EntityKitModule);
