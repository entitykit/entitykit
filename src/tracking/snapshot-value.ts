import type { ValueConverter } from '../model/value-converter/converter';
import {
    fromProviderValue,
    toProviderValue,
} from '../model/value-converter/store-value';
import { cloneSnapshotValue } from './snapshot-value-clone';
import { snapshotValuesEqual } from './snapshot-value-equality';

export { cloneSnapshotValue } from './snapshot-value-clone';

export function snapshotPropertyValue(
    value: unknown,
    converter?: ValueConverter,
): unknown {
    if (value === null || value === undefined || !converter) {
        return cloneSnapshotValue(value);
    }

    const providerSnapshot = cloneSnapshotValue(toProviderValue(value, converter));
    return fromProviderValue(providerSnapshot, converter);
}

export function snapshotPropertyValuesEqual(
    left: unknown,
    right: unknown,
    converter?: ValueConverter,
): boolean {
    return snapshotValuesEqual(
        comparableValue(left, converter),
        comparableValue(right, converter),
    );
}

function comparableValue(
    value: unknown,
    converter?: ValueConverter,
): unknown {
    return value === null || value === undefined || !converter
        ? value
        : toProviderValue(value, converter);
}
