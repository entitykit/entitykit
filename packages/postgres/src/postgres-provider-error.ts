import type { SqlStatement } from '@entitykit/core/adapter';
import {
    DatabaseProviderError,
    type DatabaseProviderErrorDetails,
    type DatabaseProviderOperation,
} from '@entitykit/core/adapter';

export function createPostgresProviderError(
    operation: DatabaseProviderOperation,
    cause: unknown,
    statement?: SqlStatement,
): DatabaseProviderError {
    const details = readPostgresError(cause);
    const codeText = details.code ? ` (${details.code})` : '';
    return new DatabaseProviderError(`Postgres ${operation} failed${codeText}.`, cause, {
        provider: 'postgres',
        operation,
        statement,
        ...details,
    });
}

function readPostgresError(
    cause: unknown,
): Omit<DatabaseProviderErrorDetails, 'provider' | 'operation' | 'statement'> {
    if (!cause || typeof cause !== 'object') {
        return {};
    }

    const record = cause as Record<string, unknown>;
    return {
        code: readString(record.code),
        constraint: readString(record.constraint),
        table: readString(record.table),
        column: readString(record.column),
        detail: readString(record.detail),
    };
}

function readString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
