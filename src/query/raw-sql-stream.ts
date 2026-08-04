import { ProviderCapabilityError } from '../errors/runtime-errors';
import type { Materializer } from '../materialization/materializer';
import type { EntityMetadata } from '../model/entity-metadata';
import type { SqlStatement } from '../sql/sql-statement';
import type { QueryStreamOptions } from '../storage/database-connection';
import { ChangeTracker } from '../tracking/change-tracker';
import type { RawSqlQueryHost } from './raw-sql-query-host';

interface RawSqlStreamOptions<TEntity extends object> {
    readonly host: RawSqlQueryHost;
    readonly metadata: EntityMetadata<TEntity>;
    readonly materializer: Materializer;
    readonly statement: () => SqlStatement;
    readonly noTracking: boolean;
    readonly stream?: QueryStreamOptions;
}

export async function* streamRawSqlEntities<TEntity extends object>(
    options: RawSqlStreamOptions<TEntity>,
): AsyncGenerator<TEntity> {
    options.host.assertCanQuery('fromSql()');
    const database = options.host.database;
    if (!database.stream) {
        throw new ProviderCapabilityError('streaming queries');
    }
    const tracker = options.noTracking
        ? new ChangeTracker()
        : options.host.changeTracker;
    try {
        for await (const row of database.stream(options.statement(), options.stream)) {
            yield options.materializer.materialize(
                options.metadata,
                row,
                tracker,
            );
        }
    } finally {
        if (tracker !== options.host.changeTracker) {
            tracker.clear();
        }
    }
}
