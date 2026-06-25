import type { EntityConstructor } from '../types';
import type { DbSetContext } from './db-set-context';
import type { EntityMetadata } from '../model/entity-metadata';
import type { QueryModel } from '../query/query-model';
import { readStoreValue } from '../storage/store-value-reader';
import { materializeProjectionRows } from './projection-row-materializer';

/**
 * Turns raw projection and aggregate result rows into typed values.
 *
 * Separated from `DbSetQueryRunner` because it is the one part of reading that
 * runs *after* the database returns: given a row and the query model it maps
 * each selected column back through its property's value reader. The runner
 * owns compile-and-execute; this owns store-value decoding, and the two only
 * meet at the row boundary.
 */
export class DbSetResultMapper<TEntity extends object> {
    constructor(
        private readonly context: DbSetContext,
        private readonly entityType: EntityConstructor<TEntity>,
    ) {}

    private get metadata(): EntityMetadata<TEntity> {
        return this.context.modelMetadata.getEntity(this.entityType);
    }

    public materializeProjectionRows<
        TProjection extends Record<string, unknown>,
    >(
        model: QueryModel<TEntity>,
        rows: ReadonlyArray<Record<string, unknown>>,
    ): TProjection[] {
        return materializeProjectionRows<TEntity, TProjection>(
            model,
            rows,
            (sourceAlias, propertyName, value) => {
                const property = this.projectionMetadataFor(
                    model,
                    sourceAlias,
                ).getProperty(propertyName);
                return readStoreValue(
                    value,
                    property,
                    this.context.valueReader,
                );
            },
        );
    }

    public materializeProjectionRow(
        model: QueryModel<TEntity>,
        row: Record<string, unknown>,
    ): Record<string, unknown> {
        return this.materializeProjectionRows<Record<string, unknown>>(
            model,
            [row],
        )[0] ?? {};
    }

    public materializeAggregateRow(
        model: QueryModel<TEntity>,
        row: Record<string, unknown>,
    ): Record<string, unknown> {
        const output: Record<string, unknown> = {};
        for (const item of model.groupKeyProjection ?? []) {
            if (item.kind === 'dateBucket') {
                output[item.alias] = materializeDateBucket(row[item.alias]);
                continue;
            }

            const property = this.projectionMetadataFor(model, item.sourceAlias).getProperty(item.propertyName);
            output[item.alias] = readStoreValue(row[item.alias], property, this.context.valueReader);
        }

        for (const item of model.aggregateProjection ?? []) {
            const value = row[item.alias];
            if (item.function === 'count') {
                output[item.alias] = value === null || value === undefined ? 0 : Number(value);
                continue;
            }

            if (value === null || value === undefined) {
                output[item.alias] = null;
                continue;
            }

            if (item.function === 'sum' || item.function === 'avg') {
                // Postgres returns `sum(integer)` as a bigint string and `sum(numeric)`
                // as exact text, so the total is normalized to a number. That rounds
                // values beyond double precision, which is why exact-numeric columns
                // are totalled through raw SQL rather than here.
                output[item.alias] = Number(value);
                continue;
            }

            if (!item.propertyName) {
                output[item.alias] = value;
                continue;
            }

            const property = this.projectionMetadataFor(model, item.sourceAlias).getProperty(item.propertyName);
            output[item.alias] = readStoreValue(value, property, this.context.valueReader);
        }
        return output;
    }

    public projectionMetadataFor(model: QueryModel<TEntity>, sourceAlias: string | undefined): EntityMetadata {
        const normalizedAlias = sourceAlias ?? 'root';
        if (normalizedAlias === 'root') {
            return this.metadata as unknown as EntityMetadata;
        }

        const join = model.joins.find(item => item.alias === normalizedAlias);
        if (!join) {
            throw new Error(`Joined projection source '${normalizedAlias}' has not been joined.`);
        }
        return join.metadata;
    }

}

function materializeDateBucket(value: unknown): Date | null {
    if (value === null || value === undefined) {
        return null;
    }

    if (value instanceof Date) {
        return value;
    }
    if (typeof value === 'string' || typeof value === 'number') {
        return new Date(value);
    }
    throw new TypeError('Date bucket results must be returned as a Date, string, or number.');
}
