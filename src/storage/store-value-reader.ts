import type {
    ValueConverter,
} from '../model/value-converter/converter';
import {
    fromProviderValue,
} from '../model/value-converter/store-value';
import { assertSynchronousCallbackResult } from '../synchronous-callback';

/**
 * Provider-owned read-side value mapping.
 *
 * Drivers differ in how faithfully they return stored values. `pg` already
 * hands back JavaScript `boolean`, `Date`, and parsed JSON values, so the
 * Postgres provider needs no reader. SQLite has no wire-level type information
 * for the driver to use, so it returns raw storage classes (`0`/`1` for a
 * boolean, an ISO string for a timestamp) and its provider supplies a reader
 * that restores the JavaScript value the mapped column type implies.
 *
 * A reader normalizes a value *before* any configured `ValueConverter` runs, so
 * converters see the same JavaScript representation on every provider.
 */
export interface StoreValueReader {
    /**
   * Convert a raw driver value into the JavaScript value `columnType` implies.
   *
   * Never called with `null` or `undefined`. Unrecognized column types must be
   * returned unchanged.
   */
    readValue(value: unknown, columnType: string): unknown;
}

/** The mapped-property fields needed to read a stored value. */
export interface StoreValueProperty {
    readonly columnType: string;
    readonly converter?: unknown;
}

/**
 * Apply provider read mapping and then any configured value converter.
 *
 * This is the single place row values become entity/projection values, so every
 * read path — materialization, projections, and aggregates — stays consistent.
 */
export function readStoreValue(value: unknown, property: StoreValueProperty, reader?: StoreValueReader): unknown {
    let stored = value;
    if (reader && value !== null && value !== undefined) {
        stored = reader.readValue(value, property.columnType);
        assertSynchronousCallbackResult(
            stored,
            'StoreValueReader.readValue()',
            message => new TypeError(message),
        );
    }

    return fromProviderValue(stored, property.converter as ValueConverter | undefined);
}
