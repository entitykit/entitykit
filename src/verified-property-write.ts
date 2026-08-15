import type { PropertyMetadata } from './model/property-metadata';
import {
    readPropertyPath,
    readPropertyValue,
    writePropertyPath,
    writePropertyValue,
} from './model/property-value-access';
import { cloneSnapshotValue } from './tracking/snapshot-value-clone';
import { snapshotValuesEqual } from './tracking/snapshot-value-equality';
import { snapshotPropertyValuesEqual } from './tracking/snapshot-value';

/** Write one mapped property and reject an accessor that refuses the value. */
export function writeVerifiedProperty(
    entity: object,
    property: PropertyMetadata,
    value: unknown,
    context: string,
): unknown {
    const expected = cloneSnapshotValue(value);
    writePropertyValue(entity, property, value);
    assertPathAncestorsAccepted(entity, property.propertyPath, context);
    const actual = readPropertyValue(entity, property);
    if (!assignedValueAccepted(actual, expected, property, context)) {
        throw refusedAssignment(context);
    }
    return actual;
}

/** Write one mapped object path and reject a silently refused assignment. */
export function writeVerifiedPath(
    entity: object,
    path: readonly string[],
    value: unknown,
    context: string,
): unknown {
    writePropertyPath(entity, path, value);
    assertPathAncestorsAccepted(entity, path, context);
    const actual = readPropertyPath(entity, path);
    if (!pathValueAccepted(actual, value)) {
        throw refusedAssignment(context);
    }
    return actual;
}

function assignedValueAccepted(
    actual: unknown,
    expected: unknown,
    property: PropertyMetadata,
    context: string,
): boolean {
    return snapshotValuesEqual(actual, expected) ||
        snapshotPropertyValuesEqual(
            actual,
            expected,
            property.converter,
            context,
        );
}

function assertPathAncestorsAccepted(
    entity: object,
    path: readonly string[],
    context: string,
): void {
    for (let index = 1; index < path.length; index++) {
        const ancestor = readPropertyPath(entity, path.slice(0, index));
        if (ancestor === null || typeof ancestor !== 'object') {
            throw refusedAssignment(context);
        }
    }
}

function pathValueAccepted(actual: unknown, value: unknown): boolean {
    if (value !== null && typeof value === 'object') {
        return actual !== null && typeof actual === 'object';
    }
    return Object.is(actual, value);
}

function refusedAssignment(context: string): Error {
    return new Error(`Property '${context}' refused its assigned value.`);
}
