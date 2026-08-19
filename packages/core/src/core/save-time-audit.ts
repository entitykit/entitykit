import { EntityState } from '../tracking/entity-state';
import type { SaveTimeMutationLog } from './save-time-mutations';
import type { PersistedEntrySnapshot } from '../tracking/persisted-entry-snapshot';
import { writeSaveTimeProperty } from './save-time-property-write';
import type { RestorationScope } from '../restoration-scope';

export function applyAuditWrites(
    snapshot: PersistedEntrySnapshot,
    now: () => Date,
    userId: () => unknown,
    mutations: SaveTimeMutationLog,
    scope: RestorationScope,
): void {
    const { entry } = snapshot;
    const audit = entry.metadata.audit;
    if (!audit) {
        return;
    }

    if (snapshot.state === EntityState.Added) {
        for (const [configuredProperty, value, onlyIfMissing] of [
            [audit.createdAtProperty, now, true],
            [audit.updatedAtProperty, now, false],
            [audit.createdByProperty, userId, true],
            [audit.updatedByProperty, userId, false],
        ] as const) {
            const property = readPropertyName(configuredProperty);
            if (property) {
                setIfConfigured(
                    snapshot,
                    property,
                    value(),
                    onlyIfMissing,
                    mutations,
                    scope,
                );
            }
        }
        return;
    }

    if (snapshot.state === EntityState.Modified) {
        const updatedAtProperty = readPropertyName(audit.updatedAtProperty);
        if (updatedAtProperty) {
            setIfConfigured(
                snapshot,
                updatedAtProperty,
                now(),
                false,
                mutations,
                scope,
            );
        }
        const updatedByProperty = readPropertyName(audit.updatedByProperty);
        if (updatedByProperty) {
            setIfConfigured(
                snapshot,
                updatedByProperty,
                userId(),
                false,
                mutations,
                scope,
            );
        }
    }
}

function readPropertyName(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function setIfConfigured(
    snapshot: PersistedEntrySnapshot,
    propertyName: string,
    value: unknown,
    onlyIfMissing: boolean,
    mutations: SaveTimeMutationLog,
    scope: RestorationScope,
): void {
    if (value === undefined) {
        return;
    }

    if (
        onlyIfMissing &&
        snapshot.values[propertyName] !== undefined &&
        snapshot.values[propertyName] !== null
    ) {
        return;
    }

    writeSaveTimeProperty(
        snapshot, propertyName, value, mutations, scope,
    );
}
