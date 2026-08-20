import { toMysqlBindValue } from '../packages/mysql/src/mysql-bind-value';
import { createMysqlProviderError } from '../packages/mysql/src/mysql-provider-error';

describe('MySQL connection helpers', () => {
    it('serializes structured bind values without changing driver-native values', () => {
        const date = new Date('2026-07-29T12:34:56.789Z');
        const bytes = new Uint8Array([0, 7, 255]);

        expect(toMysqlBindValue({ nested: true })).toBe('{"nested":true}');
        expect(toMysqlBindValue(['a', 2])).toBe('["a",2]');
        expect(toMysqlBindValue(date)).toBe(date);
        expect(toMysqlBindValue(bytes)).toBe(bytes);
        expect(toMysqlBindValue(null)).toBeNull();
        expect(toMysqlBindValue(undefined)).toBeUndefined();
        expect(toMysqlBindValue('plain')).toBe('plain');
        expect(toMysqlBindValue(4)).toBe(4);
    });

    it('normalizes qualified MySQL constraint errors with the failed statement', () => {
        const cause = {
            code: 'ER_DUP_ENTRY',
            sqlMessage: 'Duplicate entry \'a@example.com\' for key \'users.ux_users_email\'',
        };
        const statement = {
            text: 'insert into `users` (`email`) values (?)',
            values: ['a@example.com'],
        };

        const error = createMysqlProviderError('query', cause, statement);

        expect(error.toJSON()).toEqual({
            name: 'DatabaseProviderError',
            message: 'MySQL query failed (ER_DUP_ENTRY).',
            provider: 'mysql',
            operation: 'query',
            code: 'ER_DUP_ENTRY',
            constraint: 'users.ux_users_email',
            table: 'users',
            column: 'ux_users_email',
            detail: cause.sqlMessage,
            statement: {
                text: statement.text,
                values: ['<redacted:string>'],
            },
        });
        expect(error.toJSON({ includeSensitiveData: true }).statement).toEqual({
            text: statement.text,
            values: ['"a@example.com"'],
        });
        expect(error.cause).toBe(cause);
    });

    it('keeps unqualified keys and message-only failures useful', () => {
        const constraintError = createMysqlProviderError('query', {
            code: 'ER_DUP_ENTRY',
            message: 'Duplicate entry \'a\' for key \'PRIMARY\'',
        });
        const plainError = createMysqlProviderError('dispose', 'pool failed');

        expect(constraintError).toMatchObject({
            constraint: 'PRIMARY',
            table: undefined,
            column: 'PRIMARY',
            detail: 'Duplicate entry \'a\' for key \'PRIMARY\'',
        });
        expect(plainError).toMatchObject({
            message: 'MySQL dispose failed.',
            provider: 'mysql',
            operation: 'dispose',
            code: undefined,
            detail: undefined,
            cause: 'pool failed',
        });
    });
});
