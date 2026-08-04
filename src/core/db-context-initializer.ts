import {
    DbContextOptionsBuilder,
    hasConfiguredTenantScope,
} from './context-options/db-context-options-builder';
import type { DbContextOptions } from './context-options/db-context-option-types';
import type { Model } from '../model/model';
import { ModelBuilder } from '../model/model-builder';
import type { ChangeTracker } from '../tracking/change-tracker';
import { attachLazyLoader } from './lazy-loading';
import type { LazyNavigationCoordinator } from './lazy-navigation-coordinator';
import type { DbContextState } from './db-context-state';
import { configureChangeTrackerModel } from '../tracking/change-tracker-model';
import { assertSynchronousCallbackResult } from '../synchronous-callback';
import { ModelValidationError } from '../errors/model-validation-error';

/**
 * The one-time construction of a `DbContext`'s configuration: run the derived
 * class's `configure`/`model` hooks to build the options and model, then refuse
 * a model that declares tenancy the options never supply.
 *
 * Held apart from the hub because bootstrapping is a distinct phase from the
 * running unit of work — it happens once, before any tracking or saving — and
 * pulling it out keeps `DbContext.initialize` down to assigning what this
 * returns.
 */
export interface DbContextBootstrap {
    readonly options: DbContextOptions;
    readonly model: Model;
}

export function bootstrapDbContext(
    configure: (builder: DbContextOptionsBuilder) => unknown,
    buildModel: (builder: ModelBuilder) => unknown,
): DbContextBootstrap {
    const optionsBuilder = new DbContextOptionsBuilder();
    assertSynchronousCallbackResult(
        configure(optionsBuilder),
        'DbContext.configure()',
        message => new Error(message),
    );

    const modelBuilder = new ModelBuilder();
    assertSynchronousCallbackResult(
        buildModel(modelBuilder),
        'DbContext.model()',
        message => new ModelValidationError(message, {
            contractViolation: 'asyncContextModel',
        }),
    );
    const model = modelBuilder.build();

    assertTenantScopeConfigured(hasConfiguredTenantScope(optionsBuilder), model);
    const options = optionsBuilder.build();
    return { options, model };
}

export function initializeDbContext(
    state: DbContextState,
    changeTracker: ChangeTracker,
    lazyNavigation: LazyNavigationCoordinator,
    configure: (builder: DbContextOptionsBuilder) => unknown,
    buildModel: (builder: ModelBuilder) => unknown,
): void {
    if (state.initialized) {
        return;
    }

    const { options, model } = bootstrapDbContext(configure, buildModel);
    state.initialize(options, model);
    configureChangeTrackerModel(changeTracker, model);

    if (options.lazyLoading) {
        changeTracker.observeTracked(entity => {
            attachLazyLoader(entity, lazyNavigation);
        });
    }
}

/**
 * Refuse a context whose model declares tenancy that its options never supply.
 *
 * Without a tenant provider the scope enforces nothing: queries stop being
 * scoped and the save-time guard stops rejecting another tenant's rows — worse
 * than no boundary, because the model reads as though one exists.
 */
function assertTenantScopeConfigured(tenantScopeConfigured: boolean, model: Model): void {
    if (tenantScopeConfigured) {
        return;
    }

    const scoped = model.entities.filter(entity =>
        typeof (entity as unknown as { readonly tenantKeyProperty?: unknown })
            .tenantKeyProperty === 'string',
    );
    if (scoped.length === 0) {
        return;
    }

    const names = scoped.map(entity => `'${entity.entityName}'`).join(', ');
    const subject = scoped.length === 1 ? `Entity ${names} configures` : `Entities ${names} configure`;
    throw new Error(
        `${subject} a tenant key, but no tenant scope is configured. ` +
    'Call options.useTenantScope(...) in configure(), or explicitly configure a cross-tenant context.',
    );
}
