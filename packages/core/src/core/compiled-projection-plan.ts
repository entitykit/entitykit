import type { EntityConstructor } from '../types';
import type { PropertyMetadata } from '../model/property-metadata';
import { isCompiledModelMetadata } from '../model/compiled-model';
import type { QueryModel } from '../query/query-model';
import { ownFlatProjectionQuery } from '../query/owned-flat-projection';
import { readStoreValue } from '../storage/store-value-reader';
import type { DbSetContext } from './db-set-context';
import { defineResultProperty } from './projection-row-materializer';

export interface CompiledProjectionPlan<TEntity extends object> {
    readonly model: QueryModel<TEntity>;
    materializeRows<TProjection extends Record<string, unknown>>(
        rows: ReadonlyArray<Record<string, unknown>>,
    ): TProjection[];
}

/** Resolve immutable mapping once per field; retain no plan across executions. */
export function tryCompileProjectionPlan<TEntity extends object>(
    context: Pick<DbSetContext, 'modelMetadata' | 'valueReader'>,
    entityType: EntityConstructor<TEntity>,
    model: QueryModel<TEntity>,
): CompiledProjectionPlan<TEntity> | undefined {
    const metadata = context.modelMetadata;
    if (!isCompiledModelMetadata(metadata)) return undefined;
    const owned = ownFlatProjectionQuery(model);
    if (owned?.entityType !== entityType) return undefined;
    const entity = metadata.getEntity(entityType);
    const fields: Array<{ readonly alias: string; readonly property: PropertyMetadata }> = [];
    for (const item of owned.projection) {
        const property = entity.tryGetProperty(item.propertyName);
        // Leave invalid-field diagnostics and empty-result behavior to legacy SQL.
        if (!property) return undefined;
        fields.push({ alias: item.alias, property });
    }
    return {
        model: owned,
        materializeRows<TProjection extends Record<string, unknown>>(rows: ReadonlyArray<Record<string, unknown>>): TProjection[] {
            return rows.map(row => {
                const output: Record<string, unknown> = {};
                for (const field of fields) {
                    const value = readStoreValue(
                        row[field.alias], field.property, context.valueReader, entity.entityName,
                    );
                    // Readers remain live and may install an inherited setter between
                    // values. The flat result root stays private until it is returned.
                    if (Object.hasOwn(Object.prototype, field.alias)) {
                        defineResultProperty(output, field.alias, value);
                    } else {
                        output[field.alias] = value;
                    }
                }
                return output as TProjection;
            });
        },
    };
}
