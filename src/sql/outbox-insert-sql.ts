import type { SqlDialect } from './sql-dialect';
import { SqlParameterBag, type SqlStatement } from './sql-statement';

export interface OutboxInsertMessage {
    readonly type: string;
    readonly payload: unknown;
    readonly aggregateId?: unknown;
    readonly occurredAt?: Date;
}

export interface OutboxInsertOptions {
    readonly schemaName?: string;
    readonly tableName: string;
    readonly typeColumn: string;
    readonly payloadColumn: string;
    readonly aggregateIdColumn?: string;
    readonly occurredAtColumn?: string;
    readonly messages: readonly OutboxInsertMessage[];
}

export function buildOutboxInsertBatch(
    dialect: SqlDialect,
    options: OutboxInsertOptions,
): SqlStatement {
    if (options.messages.length === 0) {
        throw new Error('At least one outbox message is required.');
    }

    const parameters = new SqlParameterBag(dialect);
    const columns = [options.typeColumn, options.payloadColumn];
    if (options.aggregateIdColumn) {
        columns.push(options.aggregateIdColumn);
    }
    if (options.occurredAtColumn) {
        columns.push(options.occurredAtColumn);
    }

    const rows = options.messages.map(message => {
        const values = [
            parameters.add(message.type),
            parameters.add(message.payload),
        ];
        if (options.aggregateIdColumn) {
            values.push(parameters.add(message.aggregateId));
        }
        if (options.occurredAtColumn) {
            values.push(parameters.add(message.occurredAt ?? new Date()));
        }
        return `(${values.join(', ')})`;
    });

    return {
        text: `insert into ${dialect.quoteQualifiedIdentifier(options.schemaName, options.tableName)} (${columns.map(column => dialect.quoteIdentifier(column)).join(', ')}) values ${rows.join(', ')}`,
        values: parameters.values,
    };
}
