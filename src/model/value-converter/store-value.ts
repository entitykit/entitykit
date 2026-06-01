import type { ValueConverter } from './converter';

export function toProviderValue<TProperty>(
    value: TProperty,
    converter?: ValueConverter<TProperty>,
): unknown {
    if (value === null || value === undefined || !converter) {
        return value;
    }

    return converter.toProvider(value);
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

    return converter.fromProvider(value);
}
