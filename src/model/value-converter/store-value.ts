import type { ValueConverter } from './converter';
import { assertSynchronousCallbackResult } from '../../synchronous-callback';

export function toProviderValue<TProperty>(
    value: TProperty,
    converter?: ValueConverter<TProperty>,
): unknown {
    if (value === null || value === undefined || !converter) {
        return value;
    }

    const converted = converter.toProvider(value);
    assertSynchronousCallbackResult(
        converted,
        'ValueConverter.toProvider()',
        message => new TypeError(message),
    );
    return converted;
}

export function toStoreValue<TProperty>(
    value: TProperty,
    columnType: string,
    converter?: ValueConverter<TProperty>,
): unknown {
    const converted = toProviderValue(value, converter);
    if (converted === null || converted === undefined) {
        return converted;
    }

    const normalized = columnType.trim().toLowerCase();
    if (normalized === 'json' || normalized === 'jsonb') {
        return JSON.stringify(converted);
    }

    return converted;
}

export function fromProviderValue<TProperty>(
    value: unknown,
    converter?: ValueConverter<TProperty>,
): unknown {
    if (value === null || value === undefined || !converter) {
        return value;
    }

    const converted = converter.fromProvider(value);
    assertSynchronousCallbackResult(
        converted,
        'ValueConverter.fromProvider()',
        message => new TypeError(message),
    );
    return converted;
}
