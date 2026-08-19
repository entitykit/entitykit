import type { EntityEntry } from '../../tracking/entity-entry';

export function assertNoVersionModifications(
    entry: EntityEntry<object>,
    modifiedProperties: readonly string[],
): void {
    const version = entry.metadata.properties.find(property =>
        property.isVersion && modifiedProperties.includes(property.propertyName));
    if (!version) {
        return;
    }

    throw new Error(
        `Version property '${entry.metadata.entityName}.${version.propertyName}' is managed by EntityKit and cannot be modified directly.`,
    );
}
