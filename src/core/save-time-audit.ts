import { EntityState } from '../tracking/entity-state';
import type { SaveTimeMutationLog } from './save-time-mutations';
import type { PersistedEntrySnapshot } from '../tracking/persisted-entry-snapshot';

export function applyAuditWrites(
    snapshot: PersistedEntrySnapshot,
    now: () => Date,
    userId: () => unknown,
    mutations: SaveTimeMutationLog,
): void {
    const { entry } = snapshot;
    const audit = entry.metadata.audit;
    if (!audit) {
        return;
    }

    const liveValues = entry.entity as Record<string, unknown>;

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
                    liveValues,
                    property,
                    value(),
                    onlyIfMissing,
                    mutations,
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
                liveValues,
                updatedAtProperty,
                now(),
                false,
                mutations,
            );
        }
        const updatedByProperty = readPropertyName(audit.updatedByProperty);
        if (updatedByProperty) {
            setIfConfigured(
                snapshot,
                liveValues,
                updatedByProperty,
                userId(),
                false,
                mutations,
            );
        }
    }
}

function readPropertyName(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function setIfConfigured(
    snapshot: PersistedEntrySnapshot,
    liveValues: Record<string, unknown>,
    propertyName: string,
    value: unknown,
    onlyIfMissing: boolean,
    mutations: SaveTimeMutationLog,
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

    mutations.recordCaptured(
        liveValues,
        propertyName,
        snapshot.values[propertyName],
    );
    snapshot.values[propertyName] = value;
    liveValues[propertyName] = value;
}
