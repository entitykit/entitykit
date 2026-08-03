import type { EntityMetadata } from '../model/entity-metadata';
import type { ManyToManyMetadata } from '../model/many-to-many-metadata';
import {
    buildEntityInsert,
    buildEntityInsertBatch,
    buildEntityInsertFromValues,
} from './entity-insert-sql';
import {
    buildManyToManyInsert,
    buildManyToManyInsertBatch,
} from './many-to-many-insert-sql';
import type { ManyToManyEndpointKey } from './modification-sql-helpers';
import { buildOutboxInsertBatch } from './outbox-insert-sql';
import { postgresDialect, type SqlDialect } from './sql-dialect';
import type { SqlStatement } from './sql-statement';

/**
 * Builds every INSERT the ORM emits: single- and multi-row entity inserts,
 * many-to-many link rows, and outbox messages. Separated from the other DML
 * verbs because inserts are the family that writes full column tuples with no
 * `where` clause, so their parameter layout is column-by-column, row after row
 */
export class InsertSqlBuilder {
    constructor(private readonly dialect: SqlDialect = postgresDialect) {}

    public buildInsert<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        entity: TEntity,
        allowMissingProperties: readonly string[] = [],
    ): SqlStatement {
        return buildEntityInsert(
            this.dialect,
            metadata,
            entity,
            allowMissingProperties,
        );
    }

    public buildInsertBatch<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        entities: readonly TEntity[],
    ): SqlStatement {
        return buildEntityInsertBatch(this.dialect, metadata, entities);
    }

    public buildInsertFromValues<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        values: Readonly<Record<string, unknown>>,
    ): SqlStatement {
        return buildEntityInsertFromValues(this.dialect, metadata, values);
    }

    public buildInsertManyToMany<TEntity extends object>(
        relationship: ManyToManyMetadata<TEntity>,
        sourceKeyValues: ManyToManyEndpointKey,
        targetKeyValues: ManyToManyEndpointKey,
    ): SqlStatement {
        return buildManyToManyInsert(
            this.dialect,
            relationship,
            sourceKeyValues,
            targetKeyValues,
        );
    }

    public buildInsertManyToManyBatch<TEntity extends object>(
        relationship: ManyToManyMetadata<TEntity>,
        pairs: ReadonlyArray<readonly [unknown, unknown]>,
    ): SqlStatement {
        return buildManyToManyInsertBatch(this.dialect, relationship, pairs);
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
        return buildOutboxInsertBatch(this.dialect, {
            schemaName: options.schemaName,
            tableName: options.tableName,
            typeColumn: options.typeColumn,
            payloadColumn: options.payloadColumn,
            aggregateIdColumn: options.aggregateIdColumn,
            occurredAtColumn: options.occurredAtColumn,
            messages: [{
                type: options.type,
                payload: options.payload,
                aggregateId: options.aggregateId,
                occurredAt: options.occurredAt,
            }],
        });
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
        return buildOutboxInsertBatch(this.dialect, options);
    }
}
