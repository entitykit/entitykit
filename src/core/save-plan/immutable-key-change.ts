import type { EntityEntry } from '../../tracking/entity-entry';

export function assertNoKeyModifications(
    entry: EntityEntry<object>,
    modifiedProperties: readonly string[],
): void {
    const primary = (
        entry.metadata.keyProperties as unknown as readonly string[]
    ).find(property => modifiedProperties.includes(property));
    if (primary) {
        throw new Error(
            `Primary key changes are not supported for entity '${entry.metadata.entityName}' (property '${primary}').`,
        );
    }

    const alternate = entry.metadata.alternateKeys
        .flatMap(key => key.propertyNames.map(String))
        .find(property => modifiedProperties.includes(property));
    if (alternate) {
        throw new Error(
            `Alternate key changes are not supported for entity '${entry.metadata.entityName}' (property '${alternate}').`,
        );
    }
}
