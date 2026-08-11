import type { EntityMetadata } from '../model/entity-metadata';
import { readStoreValue, type StoreValueReader } from '../storage/store-value-reader';
import type { ChangeTracker } from '../tracking/change-tracker';
import { EntityState } from '../tracking/entity-state';
import { applyMaterializedValues } from './complex-value-materializer';
import { assertSynchronousCallbackResult } from '../synchronous-callback';
import type { MaterializedRow } from './materialized-row';
import { captureBoundRowValues } from '../tracking/bound-value-snapshot';
import { rememberMaterializedPersistenceFacts } from './materialized-bound-values';
import { createMaterializerValues } from './materializer-values';

export class Materializer {
    constructor(private readonly valueReader?: StoreValueReader) {}

    /** Materialize one entity without identity resolution or tracker retention. */
    public materializeUntracked<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        row: Record<string, unknown>,
    ): TEntity {
        const values = this.readValues(metadata, row);
        const entity = this.createEntity(metadata, values);
        const boundValues = captureBoundRowValues(
            metadata,
            row,
            this.valueReader,
        );
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
        const values = this.readValues(metadata, row);
        const boundValues = captureBoundRowValues(
            metadata,
            row,
            this.valueReader,
        );
        if (metadata.isKeyless) {
            return {
                entity: this.createEntity(metadata, values),
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

        const entity = this.createEntity(metadata, values);
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

    private createEntity<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        originalValues: Record<string, unknown>,
    ): TEntity {
        let entity: TEntity;
        if (metadata.materializer) {
            const created: unknown = metadata.materializer(
                createMaterializerValues(metadata, originalValues),
            );
            assertSynchronousCallbackResult(
                created,
                `Entity materializer for '${metadata.entityName}'`,
                message => new TypeError(message),
            );
            entity = created as TEntity;
        } else {
            entity = new (metadata.ctor as unknown as new () => TEntity)();
        }
        applyMaterializedValues(metadata, entity, originalValues);
        return entity;
    }

    private readValues<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        row: Record<string, unknown>,
    ): Record<string, unknown> {
        const values: Record<string, unknown> = {};
        for (const property of metadata.properties) {
            const value = readStoreValue(
                row[property.columnName], property, this.valueReader, metadata.entityName,
            );
            values[property.propertyName] = value;
        }
        return values;
    }
}
