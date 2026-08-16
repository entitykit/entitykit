import type { PropertyMetadata } from './model/property-metadata';
import {
    readPropertyPath,
    readPropertyValue,
    writePropertyPath,
    writePropertyValue,
} from './model/property-value-access';
import { toProviderValue } from './model/value-converter/store-value';
import { cloneSnapshotValue } from './tracking/snapshot-value-clone';
import { snapshotValuesEqual } from './tracking/snapshot-value-equality';
import {
    isImmutablePrimitiveValue,
} from './tracking/restorable-value-snapshot';

/** Pre-image fact one verified write compares the stored value against. */
type WriteExpectation =
    | { readonly kind: 'structural'; readonly snapshot: unknown }
    | { readonly kind: 'primitive'; readonly value: unknown }
    | { readonly kind: 'provider'; readonly providerValue: unknown };

/** Write one mapped property and reject an accessor that refuses the value. */
export function writeVerifiedProperty(
    entity: object,
    property: PropertyMetadata,
    value: unknown,
    context: string,
): unknown {
    const expected = captureWriteExpectation(value, property, context);
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

/** Capture the pre-image fact before an accessor can mutate the value. */
function captureWriteExpectation(
    value: unknown,
    property: PropertyMetadata,
    context: string,
): WriteExpectation {
    if (!property.converter) {
        return { kind: 'structural', snapshot: cloneSnapshotValue(value) };
    }
    if (isImmutablePrimitiveValue(value)) {
        return { kind: 'primitive', value };
    }
    return {
        kind: 'provider',
        providerValue: capturedProviderValue(value, property, context),
    };
}

/** Accept a stored value only through its own property's comparison strategy. */
function assignedValueAccepted(
    actual: unknown,
    expected: WriteExpectation,
    property: PropertyMetadata,
    context: string,
): boolean {
    if (expected.kind === 'structural') {
        return snapshotValuesEqual(actual, expected.snapshot);
    }
    if (expected.kind === 'primitive') {
        return Object.is(actual, expected.value) || snapshotValuesEqual(
            capturedProviderValue(expected.value, property, context),
            capturedProviderValue(actual, property, context),
        );
    }
    return snapshotValuesEqual(
        expected.providerValue,
        capturedProviderValue(actual, property, context),
    );
}

/** Convert one model value into an independent provider fact. */
function capturedProviderValue(
    value: unknown,
    property: PropertyMetadata,
    context: string,
): unknown {
    return cloneSnapshotValue(
        toProviderValue(value, property.converter, context),
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
