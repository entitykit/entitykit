import { serializeDefaultValue } from '../model/default-value';
import type { ModelSnapshot } from '../model/model-snapshot-types';

/** Convert default literals to the JSON-safe representation used in generated files. */
export function serializeModelSnapshot(
    snapshot: ModelSnapshot,
): ModelSnapshot {
    return {
        ...snapshot,
        entities: snapshot.entities.map(entity => ({
            ...entity,
            properties: entity.properties.map(property => ({
                ...property,
                defaultValue: serializeDefaultValue(property.defaultValue),
            })),
        })),
    };
}

export function stringifyModelSnapshot(snapshot: ModelSnapshot): string {
    return JSON.stringify(serializeModelSnapshot(snapshot), null, 2);
}
