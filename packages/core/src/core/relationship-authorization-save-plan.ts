import { relationshipPrincipalKeyProperties } from '../model/relationship-key';
import type { ModificationSqlBuilder } from '../sql/modification-sql-builder';
import type { AuthorizedRelationshipEndpoint } from '../sql/many-to-many-authorization';
import type { ChangeTracker } from '../tracking/change-tracker';
import { changeTrackerAllowsCrossTenantAccess } from '../tracking/change-tracker-tenant-capability';
import { EntityState } from '../tracking/entity-state';
import type { PersistedEntrySnapshot } from '../tracking/persisted-entry-snapshot';
import { snapshotValuesEqual } from '../tracking/snapshot-value-equality';
import type { SavePlanEntry } from './save-plan';
import { changeTrackerModel } from '../tracking/change-tracker-model';
import type { RelationshipMetadata } from '../model/relationship-metadata';

export function buildRelationshipAuthorizationSavePlan(
    sql: ModificationSqlBuilder,
    tracker: ChangeTracker,
    snapshots: readonly PersistedEntrySnapshot[],
): ReadonlyMap<object, readonly SavePlanEntry[]> {
    if (changeTrackerAllowsCrossTenantAccess(tracker)) return new Map();
    const model = changeTrackerModel(tracker);
    if (!model) return new Map();
    const byEntity: Map<object, SavePlanEntry[]> = new Map();
    for (const snapshot of snapshots) {
        if (
            snapshot.state !== EntityState.Added &&
            snapshot.state !== EntityState.Modified
        ) continue;
        for (const relationship of snapshot.entry.metadata.relationships) {
            const principalMetadata = model.getEntity(
                relationship.principalEntity,
            );
            const dependentTenant = snapshot.entry.metadata.tenantKeyProperty as
                string | undefined;
            const principalTenant = principalMetadata.tenantKeyProperty as
                string | undefined;
            if (!dependentTenant || !principalTenant) {
                continue;
            }
            if (!relationshipChanged(snapshot, relationship.foreignKeyProperties)) {
                continue;
            }
            const foreignKey = relationship.foreignKeyProperties.map(property =>
                snapshot.boundValues[property]);
            if (foreignKey.some(value => value === null || value === undefined)) {
                continue;
            }
            if (targetsAddedPrincipal(
                tracker,
                snapshot,
                relationship,
                snapshots,
                dependentTenant,
            )) continue;
            const keyProperties = relationshipPrincipalKeyProperties(
                relationship,
                principalMetadata,
            ).map(String);
            const endpoint: AuthorizedRelationshipEndpoint = {
                metadata: principalMetadata,
                keyProperties,
                keyValues: foreignKey,
                tenant: {
                    propertyName: principalTenant,
                    value: snapshot.boundValues[dependentTenant],
                },
            };
            const entry: SavePlanEntry = {
                entity: snapshot.entry.entity,
                entityName: `${snapshot.entry.metadata.entityName}.${String(relationship.navigationProperty)}`,
                keyValue: foreignKey.length === 1 ? foreignKey[0] : foreignKey,
                state: snapshot.state,
                statement: sql.buildRelationshipAuthorization(endpoint),
                expectedAffectedRows: 1,
                isSystemGenerated: true,
            };
            const entries = byEntity.get(snapshot.entry.entity) ?? [];
            entries.push(entry);
            byEntity.set(snapshot.entry.entity, entries);
        }
    }
    return byEntity;
}

function relationshipChanged(
    snapshot: PersistedEntrySnapshot,
    foreignKeys: readonly string[],
): boolean {
    return snapshot.state === EntityState.Added || foreignKeys.some(property =>
        !snapshotValuesEqual(
            snapshot.boundValues[property],
            snapshot.originalBoundValues[property],
        ));
}

function targetsAddedPrincipal(
    tracker: ChangeTracker,
    dependent: PersistedEntrySnapshot,
    relationship: RelationshipMetadata,
    snapshots: readonly PersistedEntrySnapshot[],
    dependentTenant: string,
): boolean {
    const navigation = dependent.relationshipValues[
        String(relationship.navigationProperty)
    ];
    const navigationEntry = navigation && typeof navigation === 'object'
        ? tracker.entry(navigation)
        : undefined;
    if (
        navigationEntry?.state !== EntityState.Added ||
        navigationEntry.metadata.ctor !== relationship.principalEntity
    ) return false;
    const principal = snapshots.find(candidate =>
        candidate.entry === navigationEntry);
    return principal
        ? tenantValuesMatch(dependent, principal, dependentTenant)
        : false;
}

function tenantValuesMatch(
    dependent: PersistedEntrySnapshot,
    principal: PersistedEntrySnapshot,
    dependentTenant: string,
): boolean {
    const principalTenant = principal.entry.metadata.tenantKeyProperty as
        string | undefined;
    if (!principalTenant) return false;
    return snapshotValuesEqual(
        dependent.boundValues[dependentTenant],
        principal.boundValues[principalTenant],
    );
}
