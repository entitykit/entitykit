import type { EntityEntry } from './entity-entry';

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
