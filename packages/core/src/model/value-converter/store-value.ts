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
    return toBoundProviderValue(converted, columnType, context);
}

/** Normalize an already converted provider snapshot for SQL binding. */
export function toBoundProviderValue(
    providerValue: unknown,
    columnType: string,
    context = 'mapped property',
    propertyName?: string,
): unknown {
    if (providerValue === null || providerValue === undefined) {
        return providerValue;
    }
    if (providerValue instanceof Date && Number.isNaN(providerValue.getTime())) {
        throw new TypeError(`Invalid Date at '${diagnosticContext(context, propertyName)}'. Mapped Date values must be valid.`);
    }

    const normalized = columnType.trim().toLowerCase();
    if (normalized === 'json' || normalized === 'jsonb') {
        return serializeJsonValue(providerValue, diagnosticContext(context, propertyName));
    }

    return providerValue;
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
    propertyName?: string,
): unknown {
    if (value === null || value === undefined || !converter) {
        return value;
    }

    const converted = converter.fromProvider(value);
    assertSynchronousCallbackResult(
        converted,
        converterOperation('fromProvider', context, propertyName),
        message => new TypeError(message),
    );
    return converted;
}

/** Rebuild a model value from the representation retained for SQL binding. */
export function fromBoundPropertyValue(
    boundValue: unknown,
    property: PropertyMetadata,
    entityName?: string,
): unknown {
    const providerValue = providerValueFromBoundProperty(boundValue, property);
    return fromProviderValue(
        providerValue,
        property.converter,
        entityName
            ? `${entityName}.${property.propertyName}`
            : property.propertyName,
    );
}

export function providerValueFromBoundProperty(
    boundValue: unknown,
    property: PropertyMetadata,
): unknown {
    const columnType = property.columnType.trim().toLowerCase();
    return (columnType === 'json' || columnType === 'jsonb') &&
        typeof boundValue === 'string'
        ? JSON.parse(boundValue) as unknown
        : boundValue;
}

function converterOperation(
    direction: 'toProvider' | 'fromProvider',
    context?: string,
    propertyName?: string,
): string {
    const qualified = propertyName === undefined ? context : `${String(context)}.${propertyName}`;
    return qualified
        ? `Value converter for '${qualified}' ${direction}()`
        : `ValueConverter.${direction}()`;
}

function diagnosticContext(context: string, propertyName?: string): string {
    return propertyName === undefined ? context : `${context}.${propertyName}`;
}
