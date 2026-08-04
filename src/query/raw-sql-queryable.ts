import type { EntityMetadata } from '../model/entity-metadata';
import { Materializer } from '../materialization/materializer';
import { ChangeTracker } from '../tracking/change-tracker';
import type { DatabaseOperationOptions, QueryStreamOptions } from '../storage/database-connection';
import type { SqlStatement } from '../sql/sql-statement';
import { formatDebugSql, type DebugSqlOptions } from '../sql/debug-sql';
import { ProviderCapabilityError } from '../errors/runtime-errors';
import {
    firstResultOrNull,
    requireQueryResult,
    singleResultOrNull,
} from './query-cardinality';
import type { RawSqlQueryHost } from './raw-sql-query-host';
import { streamRawSqlEntities } from './raw-sql-stream';

interface RawSqlQueryOptions {
    readonly noTracking: boolean;
    readonly ignoreQueryFilters: boolean;
    readonly ignoreTenantScope: boolean;
}

const defaultOptions: RawSqlQueryOptions = {
    noTracking: false,
    ignoreQueryFilters: false,
    ignoreTenantScope: false,
};

export class RawSqlQueryable<TEntity extends object> {
    private readonly materializer: Materializer;

    constructor(
        private readonly metadata: EntityMetadata<TEntity>,
        private readonly host: RawSqlQueryHost,
        private readonly statement: SqlStatement,
        private readonly options: RawSqlQueryOptions = defaultOptions,
    ) {
        this.materializer = new Materializer(host.valueReader);
    }

    public async toArray(options?: DatabaseOperationOptions): Promise<TEntity[]> {
        this.host.assertCanQuery('fromSql()');
        const result = await this.host.database.query(
            this.buildStatement(),
            options,
        );
        const tracker = this.options.noTracking
            ? new ChangeTracker()
            : this.host.changeTracker;
        try {
            return this.materializer.materializeMany(
                this.metadata,
                result.rows,
                tracker,
            );
        } finally {
            if (tracker !== this.host.changeTracker) {
                tracker.clear();
            }
        }
    }

    public stream(options?: QueryStreamOptions): AsyncIterable<TEntity> {
        this.host.assertCanQuery('fromSql()');
        if (!this.host.database.stream) {
            throw new ProviderCapabilityError('streaming queries');
        }
        return streamRawSqlEntities({
            host: this.host,
            metadata: this.metadata,
            materializer: this.materializer,
            statement: () => this.buildStatement(),
            noTracking: this.options.noTracking,
            stream: options,
        });
    }

    public asNoTracking(): RawSqlQueryable<TEntity> {
        return this.with({ noTracking: true });
    }

    public ignoreQueryFilters(): RawSqlQueryable<TEntity> {
        return this.with({ ignoreQueryFilters: true });
    }

    public ignoreTenantScope(): RawSqlQueryable<TEntity> {
        return this.with({ ignoreTenantScope: true });
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
        this.host.assertCanQuery('fromSql()');
        const statement = this.buildStatement();
        return {
            text: statement.text,
            values: [...statement.values],
        };
    }

    public toDebugSql(options: DebugSqlOptions = {}): string {
        return formatDebugSql(this.toSql(), options);
    }

    private buildStatement(): SqlStatement {
        return this.host.buildStatement(this.metadata, this.statement, {
            ignoreQueryFilters: this.options.ignoreQueryFilters,
            ignoreTenantScope: this.options.ignoreTenantScope,
        });
    }

    private with(changes: Partial<RawSqlQueryOptions>): RawSqlQueryable<TEntity> {
        return new RawSqlQueryable(
            this.metadata,
            this.host,
            this.statement,
            { ...this.options, ...changes },
        );
    }
}
