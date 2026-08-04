import { ProviderCapabilityError } from '../errors/runtime-errors';
import type { Materializer } from '../materialization/materializer';
import type { EntityMetadata } from '../model/entity-metadata';
import type { SqlStatement } from '../sql/sql-statement';
import type { QueryStreamOptions } from '../storage/database-connection';
import type { RawSqlQueryHost } from './raw-sql-query-host';
import { assertTrackedRawSqlRow } from './raw-sql-result-shape';

interface RawSqlStreamOptions<TEntity extends object> {
    readonly host: RawSqlQueryHost;
    readonly metadata: EntityMetadata<TEntity>;
    readonly materializer: Materializer;
    readonly statement: SqlStatement;
    readonly tracking: boolean;
    readonly stream?: QueryStreamOptions;
}

export async function* streamRawSqlEntities<TEntity extends object>(
    options: RawSqlStreamOptions<TEntity>,
): AsyncGenerator<TEntity> {
    options.host.assertCanQuery('fromSqlUnsafe()');
    const database = options.host.database;
    if (!database.stream) {
        throw new ProviderCapabilityError('streaming queries');
    }

    for await (const row of database.stream(options.statement, options.stream)) {
        if (!options.tracking) {
            yield options.materializer.materializeUntracked(
                options.metadata,
                row,
            );
            continue;
        }

        assertTrackedRawSqlRow(options.metadata, row);
        yield options.materializer.materialize(
            options.metadata,
            row,
            options.host.changeTracker,
        );
    }
}
