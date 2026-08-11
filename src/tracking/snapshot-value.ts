import type { ValueConverter } from '../model/value-converter/converter';
import {
    fromProviderValue,
    toProviderValue,
} from '../model/value-converter/store-value';
import { cloneSnapshotValue } from './snapshot-value-clone';
import { snapshotValuesEqual } from './snapshot-value-equality';

export { cloneSnapshotValue } from './snapshot-value-clone';

export interface SnapshotPropertyValueCopies {
    readonly providerValue: unknown;
    readonly persistedValue: unknown;
    readonly liveValue: unknown;
}

export function snapshotPropertyValue(
    value: unknown,
    converter?: ValueConverter,
    context?: string,
): unknown {
    if (value === null || value === undefined || !converter) {
        return cloneSnapshotValue(value);
    }

    const providerSnapshot = snapshotProviderValue(value, converter, context);
    return modelValueFromSnapshot(providerSnapshot, converter, context);
}

/** Reconstruct independent persisted and live model values through a converter. */
export function snapshotPropertyValueCopies(
    value: unknown,
    converter?: ValueConverter,
    context?: string,
): SnapshotPropertyValueCopies {
    if (value === null || value === undefined || !converter) {
        return snapshotProviderValueCopies(value, converter, context);
    }
    const providerSnapshot = snapshotProviderValue(value, converter, context);
    return snapshotProviderValueCopies(providerSnapshot, converter, context);
}

/** Reconstruct independent model copies from one already-captured provider fact. */
export function snapshotProviderValueCopies(
    providerValue: unknown,
    converter?: ValueConverter,
    context?: string,
): SnapshotPropertyValueCopies {
    const providerSnapshot = cloneSnapshotValue(providerValue);
    if (providerSnapshot === null || providerSnapshot === undefined || !converter) {
        return {
            providerValue: cloneSnapshotValue(providerSnapshot),
            persistedValue: cloneSnapshotValue(providerSnapshot),
            liveValue: cloneSnapshotValue(providerSnapshot),
        };
    }
    return {
        providerValue: cloneSnapshotValue(providerSnapshot),
        persistedValue: modelValueFromSnapshot(
            providerSnapshot,
            converter,
            context,
        ),
        liveValue: modelValueFromSnapshot(providerSnapshot, converter, context),
    };
}

export function snapshotPropertyValuesEqual(
    left: unknown,
    right: unknown,
    converter?: ValueConverter,
    context?: string,
): boolean {
    return snapshotValuesEqual(
        comparableValue(left, converter, context),
        comparableValue(right, converter, context),
    );
}

function comparableValue(
    value: unknown,
    converter?: ValueConverter,
    context?: string,
): unknown {
    return value === null || value === undefined || !converter
        ? value
        : toProviderValue(value, converter, context);
}

function snapshotProviderValue(
    value: unknown,
    converter: ValueConverter,
    context?: string,
): unknown {
    return cloneSnapshotValue(toProviderValue(value, converter, context));
}

function modelValueFromSnapshot(
    providerSnapshot: unknown,
    converter: ValueConverter,
    context?: string,
): unknown {
    return fromProviderValue(
        cloneSnapshotValue(providerSnapshot),
        converter,
        context,
    );
}
