import type { SqlStatement } from '@entitykit/core/adapter';
import type { DatabaseQueryResult } from '@entitykit/core/adapter';
import { toMysqlBindValue } from './mysql-bind-value';
import type {
    MySqlConnection,
    MySqlPool,
    MySqlQueryResult,
} from './mysql-driver';
import { createMysqlProviderError } from './mysql-provider-error';

export async function executeMysqlQuery<TRow extends Record<string, unknown>>(
    target: MySqlConnection | MySqlPool,
    statement: SqlStatement,
    commandTimeoutMs: number | undefined,
): Promise<DatabaseQueryResult<TRow>> {
    const values = statement.values.map(toMysqlBindValue);
    try {
        const [result] = commandTimeoutMs === undefined
            ? await target.query(statement.text, values)
            : await target.query({ sql: statement.text, values, timeout: commandTimeoutMs });
        if (Array.isArray(result)) {
            const rows = result as TRow[];
            return { rows, rowCount: rows.length };
        }
        const packet = result as MySqlQueryResult;
        const affected = packet.affectedRows ?? 0;
        return packet.insertId === undefined
            ? { rows: [], rowCount: affected }
            : { rows: [], rowCount: affected, insertId: packet.insertId };
    } catch (error) {
        throw createMysqlProviderError('query', error, statement);
    }
}
