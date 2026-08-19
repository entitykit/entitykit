import type { EntityMetadata } from '../model/entity-metadata';
import { Materializer } from '../materialization/materializer';
import type {
    DatabaseOperationOptions,
    QueryStreamOptions,
} from '../storage/database-connection';
import type { SqlStatement } from '../sql/sql-statement';
import { formatDebugSql, type DebugSqlOptions } from '../sql/debug-sql';
import { ProviderCapabilityError } from '../errors/runtime-errors';
import type { RawSqlQueryHost } from './raw-sql-query-host';
import { assertTrackedRawSqlRows } from './raw-sql-result-shape';
import { streamRawSqlEntities } from './raw-sql-stream';

interface UnsafeRawSqlQueryOptions {
    readonly tracking: boolean;
}

const defaultOptions: UnsafeRawSqlQueryOptions = { tracking: false };

/** Caller-owned SQL that materializes mapped entities without ORM filtering. */
export class UnsafeRawSqlQueryable<TEntity extends object> {
    private readonly materializer: Materializer;

    constructor(
        private readonly metadata: EntityMetadata<TEntity>,
        private readonly host: RawSqlQueryHost,
        private readonly statement: SqlStatement,
        private readonly options: UnsafeRawSqlQueryOptions = defaultOptions,
    ) {
        this.materializer = new Materializer(host.valueReader);
    }

    public async toArray(
        options?: DatabaseOperationOptions,
    ): Promise<TEntity[]> {
        this.host.assertCanQuery('fromSqlUnsafe()');
        const result = await this.host.database.query(this.statement, options);
        if (!this.options.tracking) {
            return this.materializer.materializeManyUntracked(
                this.metadata,
                result.rows,
            );
        }

        assertTrackedRawSqlRows(this.metadata, result.rows);
        return this.materializer.materializeMany(
            this.metadata,
            result.rows,
            this.host.changeTracker,
        );
    }

    public stream(options?: QueryStreamOptions): AsyncIterable<TEntity> {
        this.host.assertCanQuery('fromSqlUnsafe()');
        if (!this.host.database.stream) {
            throw new ProviderCapabilityError('streaming queries');
        }
        return streamRawSqlEntities({
            host: this.host,
            metadata: this.metadata,
            materializer: this.materializer,
            statement: this.statement,
            tracking: this.options.tracking,
            stream: options,
        });
    }

    public asTracking(): UnsafeRawSqlQueryable<TEntity> {
        return this.with({ tracking: true });
    }

    public asNoTracking(): UnsafeRawSqlQueryable<TEntity> {
        return this.with({ tracking: false });
    }

    public toSql(): SqlStatement {
        this.host.assertCanQuery('fromSqlUnsafe()');
        return {
            text: this.statement.text,
            values: [...this.statement.values],
        };
    }

    public toDebugSql(options: DebugSqlOptions = {}): string {
        return formatDebugSql(this.toSql(), options);
    }

    private with(
        changes: Partial<UnsafeRawSqlQueryOptions>,
    ): UnsafeRawSqlQueryable<TEntity> {
        return new UnsafeRawSqlQueryable(
            this.metadata,
            this.host,
            this.statement,
            { ...this.options, ...changes },
        );
    }
}
