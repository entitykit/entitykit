import type { CompiledEntityPlan } from './compiled-entity-plan';
import type { MaterializedValueCapture } from './materialized-value-capture';
import { toBoundProviderValue } from '../model/value-converter/store-value';
import { readStoreProviderValue, type StoreValueReader } from '../storage/store-value-reader';
import { cloneSnapshotValue } from '../tracking/snapshot-value-clone';
import { snapshotValuesEqual } from '../tracking/snapshot-value-equality';
import { writeSnapshotValue } from '../tracking/write-snapshot-value';

/** Keep all decoding and ownership copies before construction or entity writes. */
export function captureCompiledEntityValues(
    plan: CompiledEntityPlan,
    row: Readonly<Record<string, unknown>>,
    reader?: StoreValueReader,
): MaterializedValueCapture {
    const values: Record<string, unknown> = {}, boundValues: Record<string, unknown> = {};
    for (const field of plan) {
        const providerValue = readStoreProviderValue(row[field.property.columnName], field.property, reader);
        writeSnapshotValue(values, field.name, cloneSnapshotValue(providerValue));
        writeSnapshotValue(boundValues, field.name, cloneSnapshotValue(toBoundProviderValue(
            cloneSnapshotValue(providerValue), field.property.columnType, field.context,
        )));
    }
    return { values, boundValues };
}

/** Flat paths still invoke setters and compare a pre-write independent snapshot. */
export function applyCompiledEntityValues(
    plan: CompiledEntityPlan,
    entity: object,
    values: Readonly<Record<string, unknown>>,
): void {
    const target = entity as Record<string, unknown>;
    for (const field of plan) {
        const value = values[field.name];
        const expected = cloneSnapshotValue(value);
        if (field.key === '__proto__') {
            Object.defineProperty(target, field.key, {
                configurable: true, enumerable: true, writable: true, value,
            });
        } else if (!Reflect.set(target, field.key, value, target)) {
            throw new TypeError(`Cannot write mapped property '${field.key}'.`);
        }
        if (!snapshotValuesEqual(target[field.key], expected)) {
            throw new Error(`Property '${field.context}' refused its assigned value.`);
        }
    }
}

/** Preserve root enumeration/getter order and every mutable-value ownership copy. */
export function cloneUnconvertedEntityValues(
    values: Record<string, unknown>,
): Record<string, unknown> {
    const cloned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
        writeSnapshotValue(cloned, key, cloneSnapshotValue(value));
    }
    return cloned;
}
