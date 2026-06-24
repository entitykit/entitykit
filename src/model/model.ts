import type { EntityConstructor } from '../types';
import type { EntityMetadata } from './entity-metadata';
import { createModelSnapshot } from './model-snapshot-serializer';
import type { ModelSnapshot } from './model-snapshot-types';
import { validateModelRelationships } from './model-relationship-validation';
import type { SequenceMetadata } from './sequence-metadata';

export class Model {
    private readonly entitiesByConstructor: Map<EntityConstructor<object>, EntityMetadata> = new Map();
    private readonly entitiesByName: Map<string, EntityMetadata> = new Map();
    private readonly entitiesByTable: Map<string, EntityMetadata> = new Map();

    public readonly sequences: readonly SequenceMetadata[];

    constructor(
        entities: readonly EntityMetadata[],
        sequences: readonly SequenceMetadata[] = [],
    ) {
        for (const entity of entities) {
            if (this.entitiesByConstructor.has(entity.ctor)) {
                throw new Error(`Entity '${entity.entityName}' is registered more than once.`);
            }

            if (this.entitiesByName.has(entity.entityName)) {
                throw new Error(`Entity name '${entity.entityName}' is registered more than once.`);
            }

            const tableKey = entity.tablePath.join('.');
            const existingTableEntity = this.entitiesByTable.get(tableKey);
            if (existingTableEntity) {
                throw new Error(`Entities '${existingTableEntity.entityName}' and '${entity.entityName}' map to the same table '${tableKey}'.`);
            }

            this.entitiesByConstructor.set(entity.ctor, entity);
            this.entitiesByName.set(entity.entityName, entity);
            this.entitiesByTable.set(tableKey, entity);
        }

        validateModelRelationships(
            this.entities,
            this.entitiesByConstructor,
        );
        const identities: Set<string> = new Set();
        for (const sequence of sequences) {
            const identity = `${sequence.schemaName ?? ''}.${sequence.name}`;
            if (identities.has(identity)) {
                throw new Error(`Sequence '${identity}' is registered more than once.`);
            }
            identities.add(identity);
        }
        this.sequences = [...sequences];
    }

    public get entities(): readonly EntityMetadata[] {
        return Array.from(this.entitiesByConstructor.values());
    }

    public getEntity<TEntity extends object>(ctor: EntityConstructor<TEntity>): EntityMetadata<TEntity> {
        const entity = this.entitiesByConstructor.get(ctor);

        if (!entity) {
            throw new Error(`Entity '${ctor.name}' is not registered in the model.`);
        }

        return entity as unknown as EntityMetadata<TEntity>;
    }

    public tryGetEntity<TEntity extends object>(ctor: EntityConstructor<TEntity>): EntityMetadata<TEntity> | undefined {
        return this.entitiesByConstructor.get(ctor) as unknown as EntityMetadata<TEntity> | undefined;
    }

    public toSnapshot(): ModelSnapshot {
        return createModelSnapshot(this);
    }

}
