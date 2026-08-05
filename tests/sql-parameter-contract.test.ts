import { buildRawSql } from '../src/sql/raw-sql';
import { postgresDialect } from '../src/sql/sql-dialect';
import { SqlParameterBag } from '../src/sql/sql-statement';

describe('SQL parameter contract', () => {
    it('rejects a Promise before adding it to the statement', () => {
        const parameters = new SqlParameterBag();

        expect(() => parameters.add(Promise.resolve('value'))).toThrow(
            'SQL parameters cannot be Promises. Await the value before constructing the query.',
        );
        expect(parameters.values).toEqual([]);
    });

    it('protects raw SQL interpolation and custom thenables', () => {
        const thenable = { then: (): void => undefined };

        expect(() => buildRawSql(
            postgresDialect,
            ['select ', ''] as unknown as TemplateStringsArray,
            thenable,
        )).toThrow('SQL parameters cannot be Promises');
    });

    it('consumes a rejected parameter Promise', async () => {
        const unhandled: unknown[] = [];
        const observeUnhandled = (reason: unknown): void => {
            unhandled.push(reason);
        };
        process.on('unhandledRejection', observeUnhandled);
        try {
            const parameters = new SqlParameterBag();
            expect(() => parameters.add(
                Promise.reject(new Error('parameter failed')),
            )).toThrow('SQL parameters cannot be Promises');
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(unhandled).toEqual([]);
        } finally {
            process.off('unhandledRejection', observeUnhandled);
        }
    });
});
