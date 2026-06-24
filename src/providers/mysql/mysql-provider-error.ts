import type { SqlStatement } from '../../sql/sql-statement';
import {
    DatabaseProviderError,
    type DatabaseProviderOperation,
} from '../../storage/database-provider-error';

export function createMysqlProviderError(
    operation: DatabaseProviderOperation,
    cause: unknown,
    statement?: SqlStatement,
): DatabaseProviderError {
    const record = cause && typeof cause === 'object'
        ? cause as {
            code?: unknown;
            errno?: unknown;
            message?: unknown;
            sqlMessage?: unknown;
        }
        : {};
    const code = typeof record.code === 'string' ? record.code : undefined;
    const message = typeof record.sqlMessage === 'string'
        ? record.sqlMessage
        : typeof record.message === 'string'
            ? record.message
            : undefined;

    // MySQL names the offending key in messages like
    // "Duplicate entry 'x' for key 'table.PRIMARY'".
    const constraint = message
        ? /for key '([^']+)'/i.exec(message)?.[1]
        : undefined;
    const [table, key] = constraint?.includes('.')
        ? constraint.split('.')
        : [undefined, constraint];

    return new DatabaseProviderError(
        `MySQL ${operation} failed${code ? ` (${code})` : ''}.`,
        cause,
        {
            provider: 'mysql',
            operation,
            statement,
            code,
            constraint,
            table,
            column: key,
            detail: message,
        },
    );
}
