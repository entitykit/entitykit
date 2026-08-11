import { FieldExpression } from '../query/expression/field-expression';
import type { EntityEntry } from '../tracking/entity-entry';
import type { EntityEntryStore } from '../tracking/entity-entry-store';
import {
    configureChangeTrackerStore,
} from '../tracking/change-tracker-model';
import { fixupReloadedRelationships } from '../tracking/reloaded-relationship-fixup';
import { DbContextRuntime } from './db-context-runtime';
import { assertTrackedBoundTenantBoundary } from './tracked-tenant-boundary';
import { boundQueryValue } from '../query/expression/bound-query-value';
import { materializedPersistenceFacts } from '../materialization/materialized-bound-values';
import type { LoadedEntityDatabaseValues } from '../tracking/entity-entry-store';

/** Context bridge used by explicit tracked-entry concurrency recovery. */
export abstract class DbContextConcurrency extends DbContextRuntime {
    private readonly entryStore: EntityEntryStore = {
        loadDatabaseValues: async entry => this.loadDatabaseValues(entry),
        detach: entry => {
            this.changeTracker.detach(entry.entity);
        },
        fixupReloadedRelationships: (
            entry,
            previousBoundValues,
            reloadedBoundValues,
        ) => {
            fixupReloadedRelationships(
                this.changeTracker,
                this.modelMetadata,
                entry as unknown as EntityEntry<object>,
                previousBoundValues,
                reloadedBoundValues,
            );
        },
        assertPersistedIdentity: (entry, loaded) => {
            if (
                this.changeTracker.tryGetByBoundIdentityValues(
                    entry.metadata,
                    loaded.boundValues,
                ) !== entry
            ) {
                throw new Error(
                    `Database values do not match the tracked identity for '${entry.metadata.entityName}'.`,
                );
            }
        },
    };

    protected override initialize(): void {
        super.initialize();
        configureChangeTrackerStore(this.changeTracker, this.entryStore);
    }

    private async loadDatabaseValues<TEntity extends object>(
        entry: EntityEntry<TEntity>,
    ): Promise<LoadedEntityDatabaseValues | null> {
        const allowsCrossTenantAccess =
            this.options.tenantScope?.allowCrossTenantAccess === true;
        const operation = this.beginQueryOperation();
        const boundTenant = entry.metadata.tenantKeyProperty
            ? operation.boundTenantFor(entry.metadata)?.value
            : undefined;
        assertTrackedBoundTenantBoundary(
            entry,
            boundTenant,
            allowsCrossTenantAccess,
        );
        const keyProperties = entry.metadata.keyProperties;
        const entity = await this.set(entry.metadata.ctor)
            .asNoTracking()
            .ignoreQueryFilters()
            .ignoreTenantScope()
            .where(() => {
                const properties = [...keyProperties];
                const values = keyProperties.map(propertyName =>
                    boundQueryValue(entry.originalBoundValues[propertyName]));
                const tenantProperty = entry.metadata.tenantKeyProperty;
                if (
                    tenantProperty &&
                    !properties.includes(tenantProperty)
                ) {
                    properties.push(tenantProperty);
                    values.push(boundQueryValue(
                        entry.originalBoundValues[tenantProperty],
                    ));
                }
                return properties.map((propertyName, index) =>
                    new FieldExpression<TEntity, unknown>(
                        propertyName,
                    ).eq(values[index]),
                ).reduce((left, right) => left.and(right));
            })
            .singleOrNull();
        if (!entity) return null;
        const facts = materializedPersistenceFacts(entity);
        if (!facts) {
            throw new Error(
                `Database values for '${entry.metadata.entityName}' have no bound row facts.`,
            );
        }
        return facts;
    }
}
