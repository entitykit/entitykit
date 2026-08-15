import { readPropertyValue } from '../model/property-value-access';
import { writeVerifiedProperty } from '../verified-property-write';
import type { EntityEntry } from './entity-entry';
import {
    snapshotPropertyValuesEqual,
} from './snapshot-value';
import type { RelationshipDetectionValues } from './relationship-detection-values';
import {
    relationshipBoundValuesFor,
    relationshipValuesFor,
    setRelationshipDetectionProperty,
} from './relationship-detection-values';
import { capturePropertyPersistenceFact } from './entity-persistence-fact-capture';
import { snapshotValuesEqual } from './snapshot-value-equality';

export function writeRelationshipForeignKey(
    dependent: EntityEntry<object>,
    properties: readonly string[],
    values: readonly unknown[],
    captured?: RelationshipDetectionValues,
): void {
    properties.forEach((property, index) => {
        const metadata = dependent.metadata.getProperty(property);
        const context = `${dependent.metadata.entityName}.${property}`;
        const fact = capturePropertyPersistenceFact(
            dependent.metadata, metadata, values[index],
        );
        const unchanged = captured
            ? snapshotValuesEqual(
                relationshipBoundValuesFor(dependent, captured)[property],
                fact.boundValue,
            )
            : snapshotPropertyValuesEqual(
                readPropertyValue(dependent.entity, metadata),
                fact.modelValue,
                metadata.converter,
                context,
            );
        if (!unchanged) {
            writeVerifiedProperty(
                dependent.entity, metadata, values[index], context,
            );
        }
        if (captured) {
            setRelationshipDetectionProperty(
                dependent,
                property,
                fact.modelValue,
                fact.boundValue,
                captured,
            );
        }
    });
}

export function clearOptionalRelationshipForeignKey(
    dependent: EntityEntry<object>,
    properties: readonly string[],
    captured?: RelationshipDetectionValues,
): void {
    for (const property of properties) {
        const metadata = dependent.metadata.getProperty(property);
        if (!metadata.isRequired) {
            const context = `${dependent.metadata.entityName}.${property}`;
            const current = captured
                ? relationshipValuesFor(dependent, captured)[property]
                : readPropertyValue(dependent.entity, metadata);
            if (!snapshotPropertyValuesEqual(
                current, null, metadata.converter, context,
            )) {
                writeVerifiedProperty(
                    dependent.entity, metadata, null, context,
                );
            }
            if (captured) {
                setRelationshipDetectionProperty(
                    dependent, property, null, null, captured,
                );
            }
        }
    }
}
