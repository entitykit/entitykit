import { DbContext, EntityState, type DbContextOptionsBuilder, type ModelBuilder } from '../../packages/core/src';
import { sqliteProviderServices } from '../../packages/sqlite/src';
import { postgresProviderServices } from '../../packages/postgres/src';
import { mySqlProviderServices } from '../../packages/mysql/src';
import { observedJsonRejection } from './observed-json-rejection';

type Provider = 'sqlite' | 'postgres' | 'mysql';
const table = 'ek_json_diagnostic_books';

class JsonDiagnosticBook {
    public id = 1;
    public metadata!: unknown;
}

class JsonDiagnosticContext extends DbContext {
    public readonly books = this.set(JsonDiagnosticBook);

    constructor(private readonly provider: Provider, private readonly url: string) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        if (this.provider === 'sqlite') options.useProvider(sqliteProviderServices, this.url);
        if (this.provider === 'postgres') options.useProvider(postgresProviderServices, this.url);
        if (this.provider === 'mysql') options.useProvider(mySqlProviderServices, this.url);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(JsonDiagnosticBook, entity => {
            entity.toTable(table);
            entity.hasKey(book => book.id);
            entity.property(book => book.id).hasColumnType('integer').isRequired();
            entity.property(book => book.metadata).hasColumnType('jsonb').isRequired();
        });
    }
}

export function defineJsonDiagnosticProviderTests(provider: Provider, url: () => string): void {
    it.each(['prototype', 'constructor'])('refuses hostile %s diagnostics without SQL and retries the same book', async mode => {
        const context = JsonDiagnosticContext.create(provider, url());
        const query = async (text: string): Promise<ReadonlyArray<Record<string, unknown>>> =>
            (await context.database.connection.query({ text, values: [] })).rows;
        try {
            await query(`drop table if exists ${table}`);
            await query(context.database.createScript());
            const getter = jest.fn((): never => {
                throw new Error('diagnostic accessor ran');
            });
            const constructor = function BookMetadata(): undefined {
                return undefined;
            };
            Object.defineProperty(constructor, 'name', { get: getter });
            const prototype = mode === 'prototype' ? new Proxy({}, {
                getOwnPropertyDescriptor(): never {
                    throw new Error('diagnostic descriptor failed');
                },
            }) : { constructor };
            const rejected = observedJsonRejection(new Error('nested book metadata failed'));
            const metadata: unknown = Object.assign(Object.create(prototype) as object, { nested: rejected.promise });
            const book = Object.assign(new JsonDiagnosticBook(), { metadata });
            context.books.add(book);
            await expect(context.saveChanges()).rejects.toThrow(
                'Unsupported JSON value at \'JsonDiagnosticBook.metadata\' (object)',
            );
            expect(rejected.observed()).toBe(true);
            expect(getter).not.toHaveBeenCalled();
            expect(await query(`select id from ${table}`)).toEqual([]);
            expect(context.entry(book)?.state).toBe(EntityState.Added);
            expect(context.database.connection.isInTransaction).toBe(false);
            book.metadata = { title: 'A Good Book', edition: 'Paperback' };
            await expect(context.saveChanges()).resolves.toBe(1);
            context.changeTracker.clear();
            expect(await context.books.find(1)).toMatchObject({
                id: 1, metadata: { title: 'A Good Book', edition: 'Paperback' },
            });
        } finally {
            try {
                await query(`drop table if exists ${table}`);
            } finally {
                await context.dispose();
            }
        }
    });
}
