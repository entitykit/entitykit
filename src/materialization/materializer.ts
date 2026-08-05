import type { EntityMetadata } from '../model/entity-metadata';
import { readStoreValue, type StoreValueReader } from '../storage/store-value-reader';
import type { ChangeTracker } from '../tracking/change-tracker';
import { EntityState } from '../tracking/entity-state';
import { applyMaterializedValues } from './complex-value-materializer';
import { assertSynchronousCallbackResult } from '../synchronous-callback';

export class Materializer {
    constructor(private readonly valueReader?: StoreValueReader) {}

    /** Materialize one entity without identity resolution or tracker retention. */
    public materializeUntracked<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        row: Record<string, unknown>,
    ): TEntity {
        return this.createEntity(metadata, row).entity;
    }

    public materialize<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        row: Record<string, unknown>,
        changeTracker: ChangeTracker,
    ): TEntity {
        if (metadata.isKeyless) {
            return this.createEntity(metadata, row).entity;
        }
        const keyValues = metadata.getKeyValuesFromRow(row, this.valueReader);
        const existing = changeTracker.tryGetByIdentityValues(metadata, keyValues);
        if (existing) {
            return existing.entity;
        }

        const { entity, originalValues } = this.createEntity(metadata, row);

        // Return the tracked entry's entity, not the one just built. If the identity
        // map missed above but `track` finds a collision, it keeps the instance it
        // already holds — returning the local one would hand back an untracked
        // duplicate whose edits `saveChanges()` would silently discard.
        const entry = changeTracker.track(entity, metadata, EntityState.Unchanged, originalValues);
        return entry.entity;
    }

    public materializeMany<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        rows: ReadonlyArray<Record<string, unknown>>,
        changeTracker: ChangeTracker,
    ): TEntity[] {
        return rows.map(row => this.materialize(metadata, row, changeTracker));
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
        row: Record<string, unknown>,
    ): { entity: TEntity; originalValues: Record<string, unknown> } {
        const originalValues: Record<string, unknown> = {};
        for (const property of metadata.properties) {
            const value = readStoreValue(
                row[property.columnName], property, this.valueReader, metadata.entityName,
            );
            originalValues[property.propertyName] = value;
        }
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
        return { entity, originalValues };
    }
}

function createMaterializerValues<TEntity extends object>(
    metadata: EntityMetadata<TEntity>,
    originalValues: Readonly<Record<string, unknown>>,
): Partial<TEntity> {
    const values = {} as TEntity;
    applyMaterializedValues(metadata, values, originalValues);
    return values;
}
