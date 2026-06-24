import type { EntityEntry } from '../tracking/entity-entry';
import { EntityState } from '../tracking/entity-state';
import type { SaveTimeMutationLog } from './save-time-mutations';

export function applyAuditWrites(
    entry: EntityEntry<object>,
    now: () => Date,
    userId: () => unknown,
    mutations: SaveTimeMutationLog,
): void {
    const audit = entry.metadata.audit;
    if (!audit) {
        return;
    }

    const values = entry.entity as Record<string, unknown>;

    if (entry.state === EntityState.Added) {
        for (const [configuredProperty, value, onlyIfMissing] of [
            [audit.createdAtProperty, now, true],
            [audit.updatedAtProperty, now, false],
            [audit.createdByProperty, userId, true],
            [audit.updatedByProperty, userId, false],
        ] as const) {
            const property = readPropertyName(configuredProperty);
            if (property) {
                mutations.record(values, property);
                setIfConfigured(values, property, value(), onlyIfMissing);
            }
        }
        return;
    }

    if (entry.state === EntityState.Modified) {
        const updatedAtProperty = readPropertyName(audit.updatedAtProperty);
        if (updatedAtProperty) {
            mutations.record(values, updatedAtProperty);
            setIfConfigured(values, updatedAtProperty, now(), false);
        }
        const updatedByProperty = readPropertyName(audit.updatedByProperty);
        if (updatedByProperty) {
            mutations.record(values, updatedByProperty);
            setIfConfigured(values, updatedByProperty, userId(), false);
        }
    }
}

function readPropertyName(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function setIfConfigured(
    values: Record<string, unknown>,
    propertyName: string | undefined,
    value: unknown,
    onlyIfMissing: boolean,
): void {
    if (!propertyName || value === undefined) {
        return;
    }

    if (
        onlyIfMissing &&
    values[propertyName] !== undefined &&
    values[propertyName] !== null
    ) {
        return;
    }

    values[propertyName] = value;
}
