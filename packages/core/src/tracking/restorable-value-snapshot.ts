import type { EntityMetadata } from '../model/entity-metadata';
import type { ValueConverter } from '../model/value-converter/converter';
import { cloneSnapshotValue } from './snapshot-value-clone';
import { snapshotPropertyValue } from './snapshot-value';

/** Whether cloning a model value reproduces it exactly and validly. */
export function isImmutablePrimitiveValue(value: unknown): boolean {
    return value === null ||
        typeof value !== 'object' && typeof value !== 'function';
}

/** Capture a rollback pre-image that stays a valid instance of its model type. */
export function snapshotRestorableValue(
    value: unknown,
    converter?: ValueConverter,
    context?: string,
): unknown {
    return isImmutablePrimitiveValue(value)
        ? cloneSnapshotValue(value)
        : snapshotPropertyValue(value, converter, context);
}

/** Capture one mapped property value as a restorable rollback pre-image. */
export function snapshotRestorablePropertyValue(
    metadata: EntityMetadata,
    propertyName: string,
    value: unknown,
): unknown {
    return snapshotRestorableValue(
        value,
        metadata.tryGetProperty(propertyName)?.converter,
        `${metadata.entityName}.${propertyName}`,
    );
}

/** Capture every tracked value of one entry as restorable rollback pre-images. */
export function snapshotRestorableValues(
    metadata: EntityMetadata,
    values: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
    return Object.fromEntries(Object.entries(values).map(([key, value]) => [
        key, snapshotRestorablePropertyValue(metadata, key, value),
    ]));
}
