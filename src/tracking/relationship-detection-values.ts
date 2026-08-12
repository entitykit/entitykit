import type { EntityEntry } from './entity-entry';
import { capturePropertyPersistenceFact } from './entity-persistence-fact-capture';
import { snapshotValuesEqual } from './snapshot-value-equality';

/** Scalar values captured once for one relationship-detection generation. */
export type RelationshipDetectionValues = ReadonlyMap<
    EntityEntry<object>,
    Record<string, unknown>
>;

const boundFacts: WeakMap<
    RelationshipDetectionValues,
    ReadonlyMap<EntityEntry<object>, Record<string, unknown>>
> = new WeakMap();

/** Capture every relationship key provider fact once for one detection pass. */
export function captureRelationshipDetectionValues(
    entries: ReadonlyArray<EntityEntry<object>>,
    supplied?: RelationshipDetectionValues,
): RelationshipDetectionValues {
    const values = supplied ?? new Map(entries.map(entry => [
        entry,
        Object.fromEntries([...relationshipPropertyNames(entry)].map(
            property => [
                property,
                (entry.entity as Record<string, unknown>)[property],
            ],
        )),
    ]));
    const facts = new Map(entries.map(entry => [
        entry,
        captureEntryRelationshipBoundValues(entry, values.get(entry) ?? {}),
    ]));
    boundFacts.set(values, facts);
    return values;
}

/** Use generation values when supplied, otherwise read the live entity. */
export function relationshipValuesFor(
    entry: EntityEntry<object>,
    captured?: RelationshipDetectionValues,
): Record<string, unknown> {
    return captured?.get(entry) ??
        entry.entity as Record<string, unknown>;
}

export function relationshipBoundValuesFor(
    entry: EntityEntry<object>,
    captured: RelationshipDetectionValues,
): Readonly<Record<string, unknown>> {
    const values = boundFacts.get(captured)?.get(entry);
    if (!values) {
        throw new Error('Relationship provider facts were not captured.');
    }
    return values;
}

export function relationshipPropertyWasModified(
    entry: EntityEntry<object>,
    property: string,
    captured: RelationshipDetectionValues,
): boolean {
    return !snapshotValuesEqual(
        relationshipBoundValuesFor(entry, captured)[property],
        entry.originalBoundValues[property],
    );
}

export function setRelationshipDetectionProperty(
    entry: EntityEntry<object>,
    property: string,
    modelValue: unknown,
    boundValue: unknown,
    captured: RelationshipDetectionValues,
): void {
    const values = captured.get(entry);
    const bound = boundFacts.get(captured)?.get(entry);
    if (!values || !bound) {
        throw new Error('Relationship provider facts were not captured.');
    }
    values[property] = modelValue;
    bound[property] = boundValue;
}

function captureEntryRelationshipBoundValues(
    entry: EntityEntry<object>,
    values: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
    return Object.fromEntries([...relationshipPropertyNames(entry)].map(
        propertyName => {
            const value = values[propertyName];
            const original = entry.originalValues[propertyName];
            const bound = Object.is(value, original)
                ? entry.originalBoundValues[propertyName]
                : capturePropertyPersistenceFact(
                    entry.metadata,
                    entry.metadata.getProperty(propertyName),
                    value,
                ).boundValue;
            return [propertyName, bound];
        },
    ));
}

function relationshipPropertyNames(
    entry: EntityEntry<object>,
): ReadonlySet<string> {
    const tenantProperty = entry.metadata.tenantKeyProperty as
        string | undefined;
    const properties = new Set([
        ...entry.metadata.keyProperties.map(String),
        ...entry.metadata.alternateKeys.flatMap(
            key => key.propertyNames.map(String),
        ),
        ...entry.metadata.relationships.flatMap(
            relationship => relationship.foreignKeyProperties.map(String),
        ),
    ]);
    if (tenantProperty) properties.add(tenantProperty);
    return properties;
}
