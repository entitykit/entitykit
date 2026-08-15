import type { EntityMetadata } from '../model/entity-metadata';
import { EntityState } from '../tracking/entity-state';
import { SaveTimeMutationLog } from './save-time-mutations';
import type { PersistedEntrySnapshot } from '../tracking/persisted-entry-snapshot';
import { readPropertyValue } from '../model/property-value-access';
import { ensurePolicyPropertyPath } from './policy-property-path';
import { applyTenantWriteScope } from './tenant-write-scope';
import { assertTrackedTenantBoundary } from './tracked-tenant-boundary';
import type { RestorationScope } from '../restoration-scope';
import { writeFailureAtomicProperty } from '../failure-atomic-property-write';

export function applyTenantWrite(
    snapshot: PersistedEntrySnapshot,
    tenantId: unknown,
    allowsCrossTenantAccess: boolean,
    mutations: SaveTimeMutationLog,
    scope: RestorationScope,
): boolean {
    const { entry } = snapshot;
    const configuredProperty: unknown = entry.metadata.tenantKeyProperty;
    const tenantProperty = typeof configuredProperty === 'string'
        ? configuredProperty
        : undefined;
    if (!tenantProperty) {
        return false;
    }
    const property = entry.metadata.getProperty(tenantProperty);
    if (snapshot.state !== EntityState.Added) {
        assertTrackedTenantBoundary(
            entry,
            tenantId,
            allowsCrossTenantAccess,
            snapshot.values,
        );
    }
    return applyTenantWriteScope({
        entityName: entry.metadata.entityName,
        tenantProperty,
        property,
        readValue: () => snapshot.values[tenantProperty],
        writeValue: value => {
            snapshot.values[tenantProperty] = value;
            return value;
        },
        isAdded: snapshot.state === EntityState.Added,
        tenantId,
        allowsCrossTenantAccess,
        recordMutation: () => undefined,
        mirrorMutation: value => {
            ensurePolicyPropertyPath(
                entry.metadata,
                entry.entity,
                property,
                mutations,
                scope,
            );
            return writeFailureAtomicProperty({
                entity: entry.entity,
                property,
                value,
                scope,
                context: `${entry.metadata.entityName}.${tenantProperty}`,
                recordApplied: (previous, applied) => {
                    mutations.recordApplied(
                        entry.entity,
                        property,
                        previous,
                        applied,
                        `${entry.metadata.entityName}.${tenantProperty}`,
                    );
                },
            });
        },
    });
}

export function applyTenantOnAdd<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    entity: TEntity,
    currentTenantId: () => unknown,
    allowsCrossTenantAccess: boolean,
    scope: RestorationScope,
): () => void {
    const tenantProperty = metadata.tenantKeyProperty;
    if (!tenantProperty || allowsCrossTenantAccess) {
        return () => undefined;
    }
    const property = metadata.getProperty(tenantProperty);
    const mutations = new SaveTimeMutationLog();
    try {
        applyTenantWriteScope({
            entityName: metadata.entityName,
            tenantProperty,
            property,
            readValue: () => readPropertyValue(entity, property),
            writeValue: value => {
                ensurePolicyPropertyPath(
                    metadata, entity, property, mutations, scope,
                );
                return writeFailureAtomicProperty({
                    entity,
                    property,
                    value,
                    scope,
                    context: `${metadata.entityName}.${tenantProperty}`,
                    recordApplied: (previous, applied) => {
                        mutations.recordApplied(
                            entity, property, previous, applied,
                            `${metadata.entityName}.${tenantProperty}`,
                        );
                    },
                });
            },
            isAdded: true,
            tenantId: currentTenantId(),
            allowsCrossTenantAccess,
            recordMutation: () => undefined,
        });
    } catch (error) {
        scope.capturePrimary(error);
        scope.attempt(mutations.restore.bind(mutations));
        throw error;
    }
    return () => {
        mutations.restore();
    };
}
