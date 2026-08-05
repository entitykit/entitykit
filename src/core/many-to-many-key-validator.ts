import { DbValidationError } from '../errors/entity-kit-error';
import type { EntityMetadata } from '../model/entity-metadata';
import type { EntityEntry } from '../tracking/entity-entry';
import { EntityState } from '../tracking/entity-state';
import { temporaryGeneratedProperty } from '../tracking/temporary-generated-identity';
import type { ManyToManyChange } from './many-to-many-change';

export function validateManyToManyKeyValues(
    change: ManyToManyChange,
    side: 'source' | 'target',
    relationshipName: string,
    metadata: EntityMetadata,
    keyValues: readonly unknown[],
    entry?: EntityEntry<object>,
): void {
    const emptyIndex = keyValues.findIndex(
        (value, index) => isInvalidEmptyKey(
            value,
            entry,
            String(metadata.keyProperties[index]),
        ),
    );
    if (emptyIndex < 0) {
        return;
    }
    throw new DbValidationError(
        `Cannot ${change.action} many-to-many relationship '${relationshipName}' because the ${side} entity '${metadata.entityName}' has an empty key '${String(metadata.keyProperties[emptyIndex])}'.`,
        {
            action: change.action,
            relationship: relationshipName,
            side,
            entity: metadata.entityName,
            keyProperty: metadata.keyProperties[emptyIndex],
        },
    );
}

function isInvalidEmptyKey(
    value: unknown,
    entry: EntityEntry<object> | undefined,
    propertyName: string,
): boolean {
    const isEmpty = value === undefined || value === null || value === '';
    return isEmpty && !isTemporaryGeneratedProperty(entry, propertyName);
}

function isTemporaryGeneratedProperty(
    entry: EntityEntry<object> | undefined,
    propertyName: string,
): boolean {
    return entry?.state === EntityState.Added &&
        temporaryGeneratedProperty(entry, propertyName) !== undefined;
}
