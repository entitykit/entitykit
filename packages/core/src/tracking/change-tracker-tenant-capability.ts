import type { ChangeTracker } from './change-tracker';

const crossTenantTrackers: WeakSet<ChangeTracker> = new WeakSet();

export function configureChangeTrackerTenantCapability(
    tracker: ChangeTracker,
    allowsCrossTenantAccess: boolean,
): void {
    if (allowsCrossTenantAccess) crossTenantTrackers.add(tracker);
    else crossTenantTrackers.delete(tracker);
}

export function changeTrackerAllowsCrossTenantAccess(
    tracker: ChangeTracker,
): boolean {
    return crossTenantTrackers.has(tracker);
}
