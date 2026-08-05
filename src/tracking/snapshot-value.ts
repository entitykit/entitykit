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
    context?: string,
): unknown {
    if (value === null || value === undefined || !converter) {
        return cloneSnapshotValue(value);
    }

    const providerSnapshot = cloneSnapshotValue(
        toProviderValue(value, converter, context),
    );
    return fromProviderValue(providerSnapshot, converter, context);
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
