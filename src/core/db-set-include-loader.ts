import type { EntityMetadata } from '../model/entity-metadata';
import { IncludeLoader } from '../query/include-loader';
import type { QueryModel } from '../query/query-model';
import type { DatabaseOperationOptions } from '../storage/database-connection';
import type { ChangeTracker } from '../tracking/change-tracker';
import type { DbSetContext } from './db-set-context';
import type { DbSetDiagnostics } from './db-set-diagnostics';
import type { QueryFilterOperation } from './query-filter-operation';

/** Load one query's include graph through its immutable filter operation. */
export async function loadDbSetIncludes<TEntity extends object>(
    context: DbSetContext,
    diagnostics: DbSetDiagnostics<TEntity>,
    metadata: EntityMetadata<TEntity>,
    entities: readonly TEntity[],
    model: QueryModel<TEntity>,
    changeTracker: ChangeTracker,
    applyQueryFilters: QueryFilterOperation['apply'],
    options?: DatabaseOperationOptions,
): Promise<void> {
    return new IncludeLoader(
        context.modelMetadata,
        context.database,
        changeTracker,
        applyQueryFilters,
        context.dialect,
        event => {
            diagnostics.emitIncludeDiagnostic(event);
        },
        context.valueReader,
        options,
    ).load(metadata, entities, model.includes);
}
