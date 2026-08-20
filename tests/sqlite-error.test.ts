import { DatabaseProviderError } from '../packages/core/src';
import { sqliteError } from '../packages/sqlite/src/sqlite-error';

describe('SQLite provider errors', () => {
    it('does not wrap an already normalized provider error twice', () => {
        const statement = { text: 'select missing from widgets', values: [] };
        const normalized = sqliteError('query', {
            code: 'ERR_SQLITE_ERROR',
            errcode: 1,
            message: 'no such column: missing',
        }, statement);

        const remapped = sqliteError('query', normalized, statement);

        expect(remapped).toBe(normalized);
        expect(remapped).toBeInstanceOf(DatabaseProviderError);
        expect(remapped.message).toBe(
            'SQLite query failed (1). no such column: missing',
        );
    });
});
