import type { EntityEntry } from './entity-entry';

export function formatChangeTracker(
    entries: ReadonlyArray<EntityEntry<object>>,
): string {
    return entries.length === 0
        ? 'No tracked entities.'
        : entries.map(formatTrackedEntry).join('\n');
}

export function formatTrackedEntry(entry: EntityEntry<object>): string {
    const keyParts = entry.metadata.keyProperties
        .map(propertyName =>
            `${String(propertyName)}: ${JSON.stringify(
                (entry.entity as Record<string, unknown>)[propertyName],
            )}`,
        )
        .join(', ');
    const header = `${entry.metadata.entityName} { ${keyParts} } ${entry.state}`;
    const modifiedLines = entry.modifiedProperties().map(propertyName => {
        const originalValue = entry.originalValues[propertyName];
        const currentValue = entry.currentValues()[propertyName];
        return `  ${propertyName}: ${formatValue(originalValue)} -> ${formatValue(currentValue)}`;
    });

    return [header, ...modifiedLines].join('\n');
}

function formatValue(value: unknown): string {
    return JSON.stringify(
        value instanceof Date ? value.toISOString() : value,
    );
}
