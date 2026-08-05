import type { ValueConverter } from './converter';
import { assertSynchronousCallbackResult } from '../../synchronous-callback';
import { serializeJsonValue } from '../../json-value';
import type { PropertyMetadata } from '../property-metadata';

export function toProviderValue<TProperty>(
    value: TProperty,
    converter?: ValueConverter<TProperty>,
    context?: string,
): unknown {
    if (value === null || value === undefined || !converter) {
        return value;
    }

    const converted = converter.toProvider(value);
    assertSynchronousCallbackResult(
        converted,
        converterOperation('toProvider', context),
        message => new TypeError(message),
    );
    return converted;
}

export function toStoreValue<TProperty>(
    value: TProperty,
    columnType: string,
    converter?: ValueConverter<TProperty>,
    context = 'mapped JSON property',
): unknown {
    const converted = toProviderValue(value, converter, context);
    if (converted === null || converted === undefined) {
        return converted;
    }

    const normalized = columnType.trim().toLowerCase();
    if (normalized === 'json' || normalized === 'jsonb') {
        return serializeJsonValue(converted, context);
    }

    return converted;
}

/** Convert a mapped model value to the exact representation bound to its column. */
export function toBoundPropertyValue(
    value: unknown,
    property: PropertyMetadata,
    entityName?: string,
): unknown {
    const propertyName = property.propertyName;
    return toStoreValue(
        value,
        property.columnType,
        property.converter,
        entityName ? `${entityName}.${propertyName}` : propertyName,
    );
}

export function fromProviderValue<TProperty>(
    value: unknown,
    converter?: ValueConverter<TProperty>,
    context?: string,
): unknown {
    if (value === null || value === undefined || !converter) {
        return value;
    }

    const converted = converter.fromProvider(value);
    assertSynchronousCallbackResult(
        converted,
        converterOperation('fromProvider', context),
        message => new TypeError(message),
    );
    return converted;
}

function converterOperation(
    direction: 'toProvider' | 'fromProvider',
    context?: string,
): string {
    return context
        ? `Value converter for '${context}' ${direction}()`
        : `ValueConverter.${direction}()`;
}
