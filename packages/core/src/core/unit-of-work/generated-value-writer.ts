import type { EntityMetadata } from '../../model/entity-metadata';
import {
    readPropertyPath,
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
import type { RestorationScope } from '../../restoration-scope';
import { writeFailureAtomicProperty } from '../../failure-atomic-property-write';

export function applyPreparedGeneratedRow<TEntity extends object>(
    entity: TEntity,
    metadata: EntityMetadata<TEntity>,
    values: ReadonlyArray<PreparedGeneratedValue<TEntity>>,
    mutations: SaveTimeMutationLog,
    scope: RestorationScope,
): readonly AppliedPropertyValue[] {
    return values.map(value => applyPreparedGeneratedValue(
        entity,
        value,
        mutations,
        scope,
        metadata,
    ));
}

export function writeGeneratedValue<TEntity extends object>(
    entity: TEntity,
    property: PropertyMetadata<TEntity>,
    storeValue: unknown,
    mutations: SaveTimeMutationLog,
    scope: RestorationScope,
    valueReader: StoreValueReader | undefined,
    metadata: EntityMetadata<TEntity>,
): AppliedPropertyValue {
    return applyPreparedGeneratedValue(
        entity,
        prepareGeneratedValue(
            property,
            storeValue,
            valueReader,
            metadata.entityName,
        ),
        mutations,
        scope,
        metadata,
    );
}

export function applyPreparedGeneratedValue<TEntity extends object>(
    entity: TEntity,
    prepared: PreparedGeneratedValue<TEntity>,
    mutations: SaveTimeMutationLog,
    scope: RestorationScope,
    metadata?: EntityMetadata<TEntity>,
    onRestored?: (restored: boolean) => void,
): AppliedPropertyValue {
    const { property, liveValue, context } = prepared;
    if (metadata && liveValue !== null && liveValue !== undefined) {
        ensurePolicyPropertyPath(
            metadata,
            entity,
            property,
            mutations,
            scope,
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
    writeFailureAtomicProperty({
        entity,
        property,
        value: liveValue,
        scope,
        context,
        recordApplied: (previous, applied) => {
            mutations.recordApplied(
                entity,
                property,
                previous,
                applied,
                context,
                onRestored,
            );
        },
    });
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
