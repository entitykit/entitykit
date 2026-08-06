import { FieldExpression } from '../query/expression/field-expression';
import type { EntityEntry } from '../tracking/entity-entry';
import type { EntityEntryStore } from '../tracking/entity-entry-store';
import {
    configureChangeTrackerStore,
} from '../tracking/change-tracker-model';
import { readEntityValues } from '../tracking/entity-entry-snapshot';
import { fixupReloadedRelationships } from '../tracking/reloaded-relationship-fixup';
import { DbContextRuntime } from './db-context-runtime';
import { assertTrackedTenantBoundary } from './tracked-tenant-boundary';

/** Context bridge used by explicit tracked-entry concurrency recovery. */
export abstract class DbContextConcurrency extends DbContextRuntime {
    private readonly entryStore: EntityEntryStore = {
        loadDatabaseValues: async entry => this.loadDatabaseValues(entry),
        detach: entry => {
            this.changeTracker.detach(entry.entity);
        },
        fixupReloadedRelationships: (entry, previousValues) => {
            fixupReloadedRelationships(
                this.changeTracker,
                this.modelMetadata,
                entry as unknown as EntityEntry<object>,
                previousValues,
            );
        },
        assertPersistedIdentity: (entry, values) => {
            const keyValues = entry.metadata.keyProperties.map(
                propertyName => values[propertyName],
            );
            if (
                this.changeTracker.tryGetByIdentityValues(
                    entry.metadata,
                    keyValues,
                    entry.metadata.tenantKeyProperty
                        ? values[entry.metadata.tenantKeyProperty]
                        : undefined,
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
    ): Promise<Record<string, unknown> | null> {
        const allowsCrossTenantAccess =
            this.options.tenantScope?.allowCrossTenantAccess === true;
        assertTrackedTenantBoundary(
            entry,
            this.currentTenantId(),
            allowsCrossTenantAccess,
            entry.currentValues(),
        );
        const keyProperties = entry.metadata.keyProperties;
        const keyValues = keyProperties.map(
            propertyName => entry.originalValues[propertyName],
        );
        const entity = await this.set(entry.metadata.ctor)
            .asNoTracking()
            .ignoreQueryFilters()
            .where(() => {
                const properties = [...keyProperties];
                const values = [...keyValues];
                const tenantProperty = entry.metadata.tenantKeyProperty;
                if (
                    tenantProperty &&
                    !allowsCrossTenantAccess &&
                    !properties.includes(tenantProperty)
                ) {
                    properties.push(tenantProperty);
                    values.push(entry.originalValues[tenantProperty]);
                }
                return properties.map((propertyName, index) =>
                    new FieldExpression<TEntity, unknown>(
                        propertyName,
                    ).eq(values[index]),
                ).reduce((left, right) => left.and(right));
            })
            .singleOrNull();
        return entity
            ? readEntityValues(entry.metadata, entity)
            : null;
    }
}
