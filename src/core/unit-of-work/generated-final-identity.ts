import type { EntityMetadata } from '../../model/entity-metadata';
import type { ChangeTracker } from '../../tracking/change-tracker';
import type { SavePlanEntry } from '../save-plan';
import { assertGeneratedIdentityAvailable } from './generated-identity-assertion';
import type { GeneratedValueRecorder } from './generated-value-recorder';

export function assertFinalGeneratedIdentity(
    tracker: ChangeTracker,
    recorded: GeneratedValueRecorder,
    entry: SavePlanEntry,
    metadata: EntityMetadata,
    persistedValues: Readonly<Record<string, unknown>>,
    persistedBoundValues: Readonly<Record<string, unknown>>,
): void {
    const keyValues = metadata.keyProperties.map(propertyName =>
        recorded.find(entry.entity, propertyName)?.persistedValue ??
        persistedValues[propertyName]);
    assertGeneratedIdentityAvailable(
        tracker,
        entry,
        keyValues,
        Object.fromEntries(metadata.properties.map(property => [
            property.propertyName,
            recorded.find(entry.entity, property.propertyName)?.boundValue ??
                persistedBoundValues[property.propertyName],
        ])),
    );
}
