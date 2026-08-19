import type { RawSqlQueryHost } from '../query/raw-sql-query-host';
import type { DbSetContext } from './db-set-context';

export function createDbSetRawQueryHost(
    context: DbSetContext,
): RawSqlQueryHost {
    return {
        get database() {
            return context.database;
        },
        changeTracker: context.changeTracker,
        get valueReader() {
            return context.valueReader;
        },
        assertCanQuery: operation => {
            context.assertCanQuery(operation);
        },
    };
}
