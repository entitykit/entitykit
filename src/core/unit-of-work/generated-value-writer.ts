import type { EntityMetadata } from '../../model/entity-metadata';
import {
    readPropertyPath,
    readPropertyValue,
    writePropertyValue,
} from '../../model/property-value-access';
import type { PropertyMetadata } from '../../model/property-metadata';
import type { StoreValueReader } from '../../storage/store-value-reader';
import type { SaveTimeMutationLog } from '../save-time-mutations';
import type { AppliedPropertyValue } from './applied-generated-value';
import { ensurePolicyPropertyPath } from '../policy-property-path';
import {
    prepareGeneratedValue,
    type PreparedGeneratedValue,
} from './prepared-generated-value';
import { associateRestorationFailure } from '../restoration-failures';

export function applyPreparedGeneratedRow<TEntity extends object>(
    entity: TEntity,
    metadata: EntityMetadata<TEntity>,
    values: ReadonlyArray<PreparedGeneratedValue<TEntity>>,
    mutations: SaveTimeMutationLog,
): readonly AppliedPropertyValue[] {
    return values.map(value => applyPreparedGeneratedValue(
        entity,
        value,
        mutations,
        metadata,
    ));
}

export function writeGeneratedValue<TEntity extends object>(
    entity: TEntity,
    property: PropertyMetadata<TEntity>,
    storeValue: unknown,
    mutations: SaveTimeMutationLog,
    valueReader?: StoreValueReader,
    metadata?: EntityMetadata<TEntity>,
    entityName = metadata?.entityName,
): AppliedPropertyValue {
    return applyPreparedGeneratedValue(
        entity,
        prepareGeneratedValue(
            property,
            storeValue,
            valueReader,
            entityName,
        ),
        mutations,
        metadata,
    );
}

export function applyPreparedGeneratedValue<TEntity extends object>(
    entity: TEntity,
    prepared: PreparedGeneratedValue<TEntity>,
    mutations: SaveTimeMutationLog,
    metadata?: EntityMetadata<TEntity>,
    onRestored?: (restored: boolean) => void,
): AppliedPropertyValue {
    const { property, liveValue } = prepared;
    const entityName = metadata?.entityName;
    const context = entityName
        ? `${entityName}.${property.propertyName}`
        : property.propertyName;
    if (metadata && liveValue !== null && liveValue !== undefined) {
        ensurePolicyPropertyPath(
            metadata,
            entity,
            property,
            mutations,
        );
    }
    const parentPath = property.propertyPath.slice(0, -1);
    const parent = readPropertyPath(entity, parentPath);
    if (
        parentPath.length > 0 &&
        (parent === null || parent === undefined)
    ) {
        return appliedValue(prepared);
    }
    const previous = readPropertyValue(entity, property);
    try {
        writePropertyValue(entity, property, liveValue);
    } catch (error) {
        try {
            writePropertyValue(entity, property, previous);
        } catch (restorationError) {
            associateRestorationFailure(error, restorationError);
        }
        throw error;
    }
    let applied: unknown;
    try {
        applied = readPropertyValue(entity, property);
    } catch (error) {
        try {
            writePropertyValue(entity, property, previous);
        } catch (restorationError) {
            associateRestorationFailure(error, restorationError);
        }
        throw error;
    }
    mutations.recordApplied(
        entity,
        property,
        previous,
        applied,
        context,
        onRestored,
    );
    return appliedValue(prepared);
}

function appliedValue(
    prepared: PreparedGeneratedValue,
): AppliedPropertyValue {
    return {
        propertyName: prepared.propertyName,
        persistedValue: prepared.persistedValue,
        boundValue: prepared.boundValue,
    };
}
