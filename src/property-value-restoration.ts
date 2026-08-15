import type { PropertyMetadata } from './model/property-metadata';
import {
    readPropertyValue,
    writePropertyValue,
} from './model/property-value-access';
import { snapshotPropertyValuesEqual } from './tracking/snapshot-value';

/** Restore one property and verify that its accessor accepted the value. */
export function restorePropertyValue(
    entity: object,
    property: PropertyMetadata,
    value: unknown,
    expectedSnapshot: unknown,
    context: string,
): void {
    writePropertyValue(entity, property, value);
    if (!snapshotPropertyValuesEqual(
        readPropertyValue(entity, property),
        expectedSnapshot,
        property.converter,
        context,
    )) {
        throw new Error(`Property '${context}' refused its restoration value.`);
    }
}

/** Restore one direct object slot and reject a silent accessor refusal. */
export function restoreObjectProperty(
    target: Record<string, unknown>,
    property: string,
    value: unknown,
): void {
    target[property] = value;
    if (!Object.is(target[property], value)) {
        throw new Error(
            `Property '${property}' refused its restoration value.`,
        );
    }
}
