import type { EntityMetadata } from '../model/entity-metadata';
import { Materializer } from '../materialization/materializer';
import { ChangeTracker } from '../tracking/change-tracker';
import type { DatabaseConnection, DatabaseOperationOptions } from '../storage/database-connection';
import type { StoreValueReader } from '../storage/store-value-reader';
import type { SqlStatement } from '../sql/sql-statement';
import {
    formatDebugSql,
    type DebugSqlOptions,
} from '../sql/debug-sql';
import type { QueryStreamOptions } from '../storage/database-connection';
import { ProviderCapabilityError } from '../errors/runtime-errors';
import {
    firstResultOrNull,
    requireQueryResult,
    singleResultOrNull,
} from './query-cardinality';
import { mapAsyncIterable } from '../storage/map-async-iterable';

export class RawSqlQueryable<TEntity extends object> {
    private readonly materializer: Materializer;
    private readonly valueReader?: StoreValueReader;
    private noTracking = false;

    constructor(
        private readonly metadata: EntityMetadata<TEntity>,
        private readonly database: DatabaseConnection,
        private readonly changeTracker: ChangeTracker,
        private readonly statement: SqlStatement,
        valueReader?: StoreValueReader,
    ) {
        this.valueReader = valueReader;
        this.materializer = new Materializer(valueReader);
    }

    public async toArray(options?: DatabaseOperationOptions): Promise<TEntity[]> {
        const result = await this.database.query(this.statement, options);
        const tracker = this.noTracking
            ? new ChangeTracker()
            : this.changeTracker;
        try {
            return this.materializer.materializeMany(
                this.metadata,
                result.rows,
                tracker,
            );
        } finally {
            if (tracker !== this.changeTracker) {
                tracker.clear();
            }
        }
    }

    public stream(options?: QueryStreamOptions): AsyncIterable<TEntity> {
        if (!this.database.stream) {
            throw new ProviderCapabilityError('streaming queries');
        }
        const rows = this.database.stream(this.statement, options);
        const tracker = this.noTracking
            ? new ChangeTracker()
            : this.changeTracker;
        return mapAsyncIterable(
            rows,
            row => this.materializer.materialize(this.metadata, row, tracker),
            tracker === this.changeTracker ? undefined : () => {
                tracker.clear();
            },
        );
    }

    public asNoTracking(): RawSqlQueryable<TEntity> {
        const query = new RawSqlQueryable(
            this.metadata,
            this.database,
            this.changeTracker,
            this.statement,
            this.valueReader,
        );
        query.noTracking = true;
        return query;
    }

    public async firstOrNull(options?: DatabaseOperationOptions): Promise<TEntity | null> {
        const rows = await this.toArray(options);
        return firstResultOrNull(rows);
    }

    public async first(options?: DatabaseOperationOptions): Promise<TEntity> {
        return requireQueryResult(
            await this.firstOrNull(options),
            this.metadata.entityName,
            'raw SQL query',
        );
    }

    public async singleOrNull(options?: DatabaseOperationOptions): Promise<TEntity | null> {
        const rows = await this.toArray(options);
        return singleResultOrNull(
            rows,
            this.metadata.entityName,
            'raw SQL query',
        );
    }

    public async single(options?: DatabaseOperationOptions): Promise<TEntity> {
        return requireQueryResult(
            await this.singleOrNull(options),
            this.metadata.entityName,
            'raw SQL query',
        );
    }

    public toSql(): SqlStatement {
        return {
            text: this.statement.text,
            values: [...this.statement.values],
        };
    }

    public toDebugSql(options: DebugSqlOptions = {}): string {
        return formatDebugSql(this.statement, options);
    }
}
