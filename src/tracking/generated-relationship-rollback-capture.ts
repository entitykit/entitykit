import type { PersistedEntrySnapshot } from './persisted-entry-snapshot';
import type { ChangeTracker } from './change-tracker';
import { EntityState } from './entity-state';
import { cloneBoundValues } from './bound-value-snapshot';
import { temporaryGeneratedIdentity } from './temporary-generated-identity';
import type { GeneratedIdentityRollbackSource } from './generated-identity-rollback-source';
import { captureGeneratedRelationshipRollbackTargets } from './generated-relationship-rollback-scan';

/** Capture accepted generated identities for a later outer rollback scan. */
export function captureGeneratedRelationshipRollback(
    tracker: ChangeTracker,
    snapshots: readonly PersistedEntrySnapshot[],
): () => void {
    const sources: GeneratedIdentityRollbackSource[] = snapshots.flatMap(
        snapshot => {
            const temporary = snapshot.state === EntityState.Added
                ? temporaryGeneratedIdentity(snapshot.entry)
                : undefined;
            return temporary ? [{
                entity: snapshot.entry.entity,
                entityType: snapshot.entry.metadata.ctor,
                keyProperties: snapshot.entry.metadata.keyProperties.map(String),
                tenantKeyProperty: snapshot.entry.metadata.tenantKeyProperty,
                principal: snapshot.entry,
                boundValues: cloneBoundValues(snapshot.boundValues),
                generatedProperties: new Set(temporary.properties.map(
                    property => property.propertyName,
                )),
            }] : [];
        });
    return () => {
        captureGeneratedRelationshipRollbackTargets(tracker, sources);
    };
}
