import { readPropertyValue } from '../model/property-value-access';
import type { RelationshipKeyMetadata } from '../model/relationship-key-codec';
import type { EntityEntry } from './entity-entry';
import { capturePropertyPersistenceFact } from './entity-persistence-fact-capture';
import { snapshotValuesEqual } from './snapshot-value-equality';

export interface ReferenceForeignKeyFacts {
    readonly modelValues: Record<string, unknown>;
    readonly boundValues: Record<string, unknown>;
}

/** Capture one current FK tuple, reusing persisted facts when it is unchanged. */
export function captureReferenceForeignKeyFacts(
    entry: EntityEntry<object>,
    relationship: RelationshipKeyMetadata,
): ReferenceForeignKeyFacts {
    const modelValues: Record<string, unknown> = {};
    const boundValues: Record<string, unknown> = {};
    for (const propertyName of relationship.foreignKeyProperties.map(String)) {
        const property = entry.metadata.getProperty(propertyName);
        const live = readPropertyValue(entry.entity, property);
        const original = entry.originalValues[propertyName];
        if (Object.is(live, original)) {
            modelValues[propertyName] = original;
            boundValues[propertyName] = entry.originalBoundValues[propertyName];
            continue;
        }
        const captured = capturePropertyPersistenceFact(
            entry.metadata, property, live,
        );
        const unchanged = snapshotValuesEqual(
            captured.boundValue, entry.originalBoundValues[propertyName],
        );
        modelValues[propertyName] = unchanged
            ? original
            : captured.modelValue;
        boundValues[propertyName] = unchanged
            ? entry.originalBoundValues[propertyName]
            : captured.boundValue;
    }
    return { modelValues, boundValues };
}
