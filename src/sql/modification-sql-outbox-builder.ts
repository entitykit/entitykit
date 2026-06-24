import { InsertSqlBuilder } from './insert-sql-builder';
import { postgresDialect, type SqlDialect } from './sql-dialect';
import type { SqlStatement } from './sql-statement';

/**
 * Owns the outbox part of `ModificationSqlBuilder`'s compatibility surface.
 *
 * It also supplies the shared insert strategy to the concrete facade, keeping
 * all insert-family methods on one configured builder.
 */
export abstract class ModificationSqlOutboxBuilder {
    protected readonly insertBuilder: InsertSqlBuilder;

    protected constructor(dialect: SqlDialect = postgresDialect) {
        this.insertBuilder = new InsertSqlBuilder(dialect);
    }

    public buildInsertOutboxMessage(options: {
        readonly schemaName?: string;
        readonly tableName: string;
        readonly typeColumn: string;
        readonly payloadColumn: string;
        readonly aggregateIdColumn?: string;
        readonly occurredAtColumn?: string;
        readonly type: string;
        readonly payload: unknown;
        readonly aggregateId?: unknown;
        readonly occurredAt?: Date;
    }): SqlStatement {
        return this.insertBuilder.buildInsertOutboxMessage(options);
    }

    public buildInsertOutboxMessagesBatch(options: {
        readonly schemaName?: string;
        readonly tableName: string;
        readonly typeColumn: string;
        readonly payloadColumn: string;
        readonly aggregateIdColumn?: string;
        readonly occurredAtColumn?: string;
        readonly messages: ReadonlyArray<{
            readonly type: string;
            readonly payload: unknown;
            readonly aggregateId?: unknown;
            readonly occurredAt?: Date;
        }>;
    }): SqlStatement {
        return this.insertBuilder.buildInsertOutboxMessagesBatch(options);
    }
}
