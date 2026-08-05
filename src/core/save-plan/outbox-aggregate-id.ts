import type { PersistedValueLookup } from '../save-plan-execution';
import type { EntityEntry } from '../../tracking/entity-entry';
import type { PropertyMetadata } from '../../model/property-metadata';
import { isGeneratedOnAdd } from '../../model/value-generated';
import { toProviderValue } from '../../model/value-converter/store-value';
import { serializeJsonValue, type JsonValue } from '../../json-value';
import { serializeCanonicalJson } from '../../json/canonical-json';
import { EntityState } from '../../tracking/entity-state';

interface AggregateIdPart {
    readonly tag: string;
    readonly value: string | number | boolean | null;
}

interface AggregateKeyComponent {
    readonly property: PropertyMetadata;
    readonly captured?: AggregateIdPart;
}

export interface PendingAggregateId {
    readonly entity: object;
    readonly entityName: string;
    readonly components: readonly AggregateKeyComponent[];
}

export function formatExplicitAggregateId(value: unknown, path: string): unknown {
    return aggregateIdPart(value, path).value;
}

export function captureAggregateId(entry: EntityEntry<object>): PendingAggregateId {
    const values = entry.currentValues();
    return {
        entity: entry.entity,
        entityName: entry.metadata.entityName,
        components: entry.metadata.keyPropertiesMetadata.map(property => {
            const value = values[property.propertyName];
            const generated = entry.state === EntityState.Added &&
                isGeneratedOnAdd(property.valueGenerated);
            return {
                property,
                captured: generated || isMissingKeyValue(value)
                    ? undefined
                    : mappedAggregateIdPart(
                        value,
                        property,
                        entry.metadata.entityName,
                    ),
            };
        }),
    };
}

export function formatPendingAggregateId(
    pending: PendingAggregateId,
    persistedValue?: PersistedValueLookup,
): unknown {
    const parts = pending.components.map(component => {
        const persisted = persistedValue?.(
            pending.entity,
            component.property.propertyName,
        );
        return persisted
            ? mappedAggregateIdPart(
                persisted.persistedValue,
                component.property,
                pending.entityName,
            )
            : component.captured;
    });
    if (parts.some(part => part === undefined)) {
        if (!persistedValue) {
            return undefined;
        }
        throw new Error(
            `Cannot create the outbox aggregate ID for '${pending.entityName}' because its generated primary key is unavailable.`,
        );
    }
    const complete = parts as AggregateIdPart[];
    return complete.length === 1
        ? complete[0].value
        : serializeCompositeId(complete);
}

function mappedAggregateIdPart(
    value: unknown,
    property: PropertyMetadata,
    entityName: string,
): AggregateIdPart {
    return aggregateIdPart(
        toProviderValue(
            value,
            property.converter,
            `${entityName}.${property.propertyName} outbox aggregate ID`,
        ),
        `${entityName}.${property.propertyName} outbox aggregate ID`,
    );
}

function aggregateIdPart(value: unknown, path: string): AggregateIdPart {
    if (value === null) {
        return { tag: 'null', value: null };
    }
    if (typeof value === 'string') {
        return { tag: 'string', value };
    }
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new TypeError(`Outbox aggregate ID at '${path}' must be finite.`);
        }
        return { tag: 'number', value };
    }
    if (typeof value === 'bigint') {
        return { tag: 'bigint', value: value.toString() };
    }
    if (typeof value === 'boolean') {
        return { tag: 'boolean', value };
    }
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) {
            throw new TypeError(`Outbox aggregate ID at '${path}' contains an invalid Date.`);
        }
        return { tag: 'date', value: value.toISOString() };
    }
    if (value instanceof Uint8Array) {
        return { tag: 'bytes', value: bytesToHex(value) };
    }
    return {
        tag: 'json',
        value: serializeJsonValue(value, path),
    };
}

function serializeCompositeId(parts: readonly AggregateIdPart[]): string {
    const tagged: JsonValue = [
        'entitykit:composite:v1',
        ...parts.map(part => [part.tag, part.value] satisfies JsonValue),
    ];
    return serializeCanonicalJson(tagged);
}

function bytesToHex(value: Uint8Array): string {
    return `0x${Array.from(value, byte =>
        byte.toString(16).padStart(2, '0')).join('')}`;
}

function isMissingKeyValue(value: unknown): boolean {
    return value === undefined || value === null || value === '';
}
