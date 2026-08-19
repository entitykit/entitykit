import type { EntityMetadata } from '../model/entity-metadata';
import type { Model } from '../model/model';

/** Put principal tables before their direct dependents, preserving stable order. */
export function orderTablesForCreation(model: Model): EntityMetadata[] {
    const entities = [...model.entities];
    const incoming = new Map(entities.map(entity => [entity, 0]));
    const dependents = new Map(
        entities.map(entity => [entity, new Set<EntityMetadata>()]),
    );
    for (const dependent of entities) {
        for (const relationship of dependent.relationships) {
            const principal = model.getEntity(relationship.principalEntity);
            if (
                principal === dependent ||
                dependents.get(principal)?.has(dependent)
            ) {
                continue;
            }
            dependents.get(principal)?.add(dependent);
            incoming.set(dependent, (incoming.get(dependent) ?? 0) + 1);
        }
    }

    const remaining = new Set(entities);
    const ordered: EntityMetadata[] = [];
    while (remaining.size > 0) {
        const next = entities.find(entity =>
            remaining.has(entity) && (incoming.get(entity) ?? 0) === 0,
        ) ?? entities.find(entity => remaining.has(entity));
        if (!next) {
            break;
        }
        remaining.delete(next);
        ordered.push(next);
        for (const dependent of dependents.get(next) ?? []) {
            incoming.set(dependent, (incoming.get(dependent) ?? 0) - 1);
        }
    }
    return ordered;
}
