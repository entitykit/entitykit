import type { EntityMetadata } from '../model/entity-metadata';
import type { StoreValueReader } from '../storage/store-value-reader';
import type { ChangeTracker } from '../tracking/change-tracker';
import type { EntityEntry } from '../tracking/entity-entry';
import { EntityState } from '../tracking/entity-state';
import { applyMaterializedValues } from './complex-value-materializer';
import type { MaterializedRow } from './materialized-row';
import {
    rememberMaterializedPersistenceFacts,
    reserveMaterializedEntity,
} from './materialized-bound-values';
import { captureMaterializedValues } from './materialized-value-capture';
import {
    constructMaterializedEntity,
    reusedMaterializedEntityError,
} from './materialized-entity-factory';

export class Materializer {
    private readonly materializedEntities: WeakSet<object> = new WeakSet();

    /** `onFreshEntityTracked` fires only for entries this instance registered. */
    constructor(
        private readonly valueReader?: StoreValueReader,
        private readonly onFreshEntityTracked?: (
            entry: EntityEntry<object>,
        ) => void,
    ) {}

    /** Materialize one entity without identity resolution or tracker retention. */
    public materializeUntracked<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        row: Record<string, unknown>,
    ): TEntity {
        const { values, boundValues } = captureMaterializedValues(
            metadata, row, this.valueReader,
        );
        const entity = this.createFreshEntity(metadata, values);
        rememberMaterializedPersistenceFacts(
            entity, metadata, values, boundValues,
        );
        return entity;
    }

    public materialize<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        row: Record<string, unknown>,
        changeTracker: ChangeTracker,
    ): TEntity {
        return this.materializeWithValues(metadata, row, changeTracker).entity;
    }

    public materializeWithValues<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        row: Record<string, unknown>,
        changeTracker: ChangeTracker,
    ): MaterializedRow<TEntity> {
        const { values, boundValues } = captureMaterializedValues(
            metadata, row, this.valueReader,
        );
        if (metadata.isKeyless) {
            const entity = this.createFreshEntity(
                metadata, values, changeTracker,
            );
            rememberMaterializedPersistenceFacts(
                entity, metadata, values, boundValues,
            );
            return {
                entity,
                values,
                boundValues,
            };
        }
        const existing = changeTracker.tryGetByBoundIdentityValues(
            metadata,
            boundValues,
        );
        if (existing) {
            return { entity: existing.entity, values, boundValues };
        }

        const entity = this.createFreshEntity(metadata, values, changeTracker);
        rememberMaterializedPersistenceFacts(
            entity, metadata, values, boundValues,
        );

        // Initial tracking is strict. Identity resolution must happen against the
        // captured provider row above; a collision here means materialization and
        // registration disagreed about the row and must fail closed.
        const entry = changeTracker.track(
            entity,
            metadata,
            EntityState.Unchanged,
            values,
            boundValues,
        );
        // The only moment anyone knows this tracking is ours: the identity lookup
        // above missed, the entity is brand new, and registration just succeeded.
        // The entry itself is the receipt -- a later entry under the same entity
        // belongs to whoever established it.
        this.onFreshEntityTracked?.(entry as unknown as EntityEntry<object>);
        return { entity: entry.entity, values, boundValues };
    }

    public materializeMany<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        rows: ReadonlyArray<Record<string, unknown>>,
        changeTracker: ChangeTracker,
    ): TEntity[] {
        return rows.map(row => this.materialize(metadata, row, changeTracker));
    }

    public materializeManyWithValues<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        rows: ReadonlyArray<Record<string, unknown>>,
        changeTracker: ChangeTracker,
    ): Array<MaterializedRow<TEntity>> {
        return rows.map(row =>
            this.materializeWithValues(metadata, row, changeTracker),
        );
    }

    /** Materialize entities without requiring or retaining identity keys. */
    public materializeManyUntracked<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        rows: ReadonlyArray<Record<string, unknown>>,
    ): TEntity[] {
        return rows.map(row => this.materializeUntracked(metadata, row));
    }

    private createFreshEntity<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        values: Record<string, unknown>,
        changeTracker?: ChangeTracker,
    ): TEntity {
        const entity = constructMaterializedEntity(metadata, values);
        if (
            this.materializedEntities.has(entity) ||
            !reserveMaterializedEntity(entity) ||
            changeTracker?.entry(entity)
        ) {
            throw reusedMaterializedEntityError(metadata.entityName);
        }
        this.materializedEntities.add(entity);
        applyMaterializedValues(metadata, entity, values);
        return entity;
    }
}
