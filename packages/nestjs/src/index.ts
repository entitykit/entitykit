/** Lifecycle-safe NestJS integration for EntityKit. */
export { EntityKitModule } from './entity-kit-module.js';
export { EntityKitContextRunner } from './entity-kit-context-runner.js';
export type { EntityKitContextType } from './entity-kit-context-type.js';
export type {
    EntityKitDataSourceOwnership,
    EntityKitModuleAsyncOptions,
    EntityKitModuleOptions,
} from './entity-kit-module-options.js';
export {
    getEntityKitContextRunnerToken,
    getEntityKitDataSourceToken,
    InjectEntityKitContextRunner,
    InjectEntityKitDataSource,
} from './entity-kit-provider-tokens.js';
