import type { EntityPropertyKey } from '../types';
import {
    selectPropertyPath,
    type PropertyPathSelector,
} from '../model/model-property-selector';
import type { EntityEntry } from './entity-entry';
import {
    cloneEntityValues,
} from './entity-entry-snapshot';
import { snapshotPropertyValue } from './snapshot-value';

/**
 * An immutable snapshot of the mapped values currently stored for one entry.
 *
 * Snapshots are tied to the entry that loaded them. Read a value by its typed
 * property name, or copy all mapped values into a plain object for comparison.
 */
export interface EntityDatabaseValues<TEntity extends object> {
    /** The property names. */ readonly propertyNames: readonly string[];
    /** Perform the get operation. */ get<TKey extends EntityPropertyKey<TEntity>>(
        propertyName: TKey,
    ): TEntity[TKey];
    /** Perform the get operation. */ get<TProperty>(
        selector: PropertyPathSelector<TEntity, TProperty>,
    ): TProperty;
    /** Perform the to object operation. */ toObject(): Readonly<Record<string, unknown>>;
}

interface SnapshotData {
    readonly entry: object;
    readonly values: Record<string, unknown>;
}

const snapshotData: WeakMap<object, SnapshotData> = new WeakMap();

export function createEntityDatabaseValues<TEntity extends object>(
    entry: EntityEntry<TEntity>,
    values: Record<string, unknown>,
): EntityDatabaseValues<TEntity> {
    const stored = cloneEntityValues(entry.metadata, values);
    const snapshot: EntityDatabaseValues<TEntity> = Object.freeze({
        propertyNames: Object.freeze(
            entry.metadata.properties.map(property => property.propertyName),
        ),
        /** Perform the get operation. */ get(
            propertyOrSelector:
                | EntityPropertyKey<TEntity>
                | PropertyPathSelector<TEntity>,
        ): unknown {
            const propertyName = typeof propertyOrSelector === 'function'
                ? selectPropertyPath(propertyOrSelector).join('.')
                : propertyOrSelector;
            const property = entry.metadata.getProperty(propertyName);
            return snapshotPropertyValue(
                stored[property.propertyName],
                property.converter,
            );
        },
        /** Perform the to object operation. */ toObject(): Readonly<Record<string, unknown>> {
            return Object.freeze(cloneEntityValues(entry.metadata, stored));
        },
    });
    snapshotData.set(snapshot, { entry, values: stored });
    return snapshot;
}

export function readEntityDatabaseValues<TEntity extends object>(
    entry: EntityEntry<TEntity>,
    snapshot: EntityDatabaseValues<TEntity>,
): Record<string, unknown> {
    const data = snapshotData.get(snapshot);
    if (data?.entry !== entry) {
        throw new Error(
            `Database values for '${entry.metadata.entityName}' must come from getDatabaseValues() on the same tracked entry.`,
        );
    }
    return cloneEntityValues(entry.metadata, data.values);
}
