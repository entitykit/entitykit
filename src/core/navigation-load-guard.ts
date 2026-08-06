import type { ChangeTracker } from '../tracking/change-tracker';
import type { EntityEntry } from '../tracking/entity-entry';
import { EntityState } from '../tracking/entity-state';
import { assertNoKeyModifications } from './save-plan/immutable-key-change';
import {
    ForeignEntityEntryError,
    NavigationLoadUnavailableError,
} from '../errors/navigation-errors';
import { modifiedEntityValueProperties } from '../tracking/entity-entry-snapshot';
import { assertTrackedTenantBoundary } from './tracked-tenant-boundary';

/** Require a navigation target to be the context's current persisted entry. */
export function assertNavigationEntryTracked<TEntity extends object>(
    tracker: ChangeTracker,
    entry: EntityEntry<TEntity>,
): void {
    if (tracker.entry(entry.entity) !== entry) {
        throw new ForeignEntityEntryError();
    }
    if (entry.state === EntityState.Added) {
        throw new NavigationLoadUnavailableError(
            'added',
            entry.metadata.entityName,
        );
    }
}

/** Capture and validate the immutable values used by one navigation load. */
export function captureNavigationLoadValues<TEntity extends object>(
    tracker: ChangeTracker,
    entry: EntityEntry<TEntity>,
    currentTenantId: unknown,
    allowsCrossTenantAccess: boolean,
): Readonly<Record<string, unknown>> {
    assertNavigationEntryTracked(tracker, entry);
    const currentValues = entry.currentValues();
    assertNoKeyModifications(
        entry as unknown as EntityEntry<object>,
        modifiedEntityValueProperties(
            entry.metadata,
            currentValues,
            entry.originalValues,
        ),
    );
    assertTrackedTenantBoundary(
        entry,
        currentTenantId,
        allowsCrossTenantAccess,
        currentValues,
    );

    const persisted: Set<string> = new Set([
        ...entry.metadata.keyProperties,
        ...entry.metadata.alternateKeys.flatMap(key => key.propertyNames),
    ]);
    if (entry.metadata.tenantKeyProperty) {
        persisted.add(entry.metadata.tenantKeyProperty);
    }
    for (const propertyName of persisted) {
        currentValues[propertyName] = entry.originalValues[propertyName];
    }
    return currentValues;
}
