import { DbContext, type DbContextOptionsBuilder, type ModelBuilder, type JsonValue } from '../../packages/core/src';
import type { DatabaseQueryResult } from '../../packages/core/src/adapter';
import { sqliteProviderServices } from '../../packages/sqlite/src';
import { postgresProviderServices } from '../../packages/postgres/src';
import { mySqlProviderServices } from '../../packages/mysql/src';

class Book {
    public id = 0; public title = ''; public edition: string | null = null; public price = 0;
    public data: JsonValue = null;
}

export function defineQueryCacheProviderTests(provider: 'sqlite' | 'postgres' | 'mysql', target: () => string): void {
    class Bookshop extends DbContext {
        public books = this.set(Book);
        protected override configure(options: DbContextOptionsBuilder): void {
            if (provider === 'sqlite') options.useProvider(sqliteProviderServices, target());
            else if (provider === 'postgres') options.useProvider(postgresProviderServices, target());
            else options.useProvider(mySqlProviderServices, target());
        }
        protected override model(model: ModelBuilder): void {
            model.entity(Book, entity => {
                entity.toTable('ek_query_cache_books').hasKey('id');
                entity.property('id').hasColumnType('integer');
                entity.property('title').hasColumnType('varchar(64)').isRequired();
                entity.property('edition').hasColumnType('varchar(64)');
                entity.property('price').hasColumnType('integer').isRequired();
                entity.property('data').hasColumnType('jsonb');
            });
        }
    }
    let db: Bookshop;
    const query = async (text: string): Promise<DatabaseQueryResult> => db.database.connection.query({ text, values: [] });
    beforeEach(async () => {
        db = Bookshop.create();
        await query('drop table if exists ek_query_cache_books');
        await query(db.database.createScript());
        await query('insert into ek_query_cache_books (id,title,edition,price) values (1,\'Alpha\',null,100),(2,\'Beta\',\'Paperback\',200),(3,\'Gamma\',\'Hardcover\',300)');
    });
    afterEach(async () => {
        try {
            await query('drop table if exists ek_query_cache_books');
        } finally {
            await db.dispose();
        }
    });
    it('retains null, negation, logical and membership semantics after warming the cache', async () => {
        expect(await db.books.where(row => row.edition.isNull()).select(row => ({ id: row.id })).toArray()).toEqual([{ id: 1 }]);
        expect(await db.books.where(row => row.edition.isNotNull()).orderBy(row => row.id).select(row => ({ id: row.id })).toArray()).toEqual([{ id: 2 }, { id: 3 }]);
        expect(await db.books.where(row => row.price.gt(100).not()).select(row => ({ id: row.id })).toArray()).toEqual([{ id: 1 }]);
        expect(await db.books.where(row => row.price.gt(200).not()).orderBy(row => row.id).select(row => ({ id: row.id })).toArray()).toEqual([{ id: 1 }, { id: 2 }]);
        expect(await db.books.where(row => row.edition.in([])).select(row => ({ id: row.id })).toArray()).toEqual([]);
        expect(await db.books.where(row => row.edition.in([null, 'Paperback'])).orderBy(row => row.id).select(row => ({ id: row.id })).toArray()).toEqual([{ id: 1 }, { id: 2 }]);
        expect(await db.books.where(row => row.edition.in(['Hardcover'])).select(row => ({ id: row.id })).toArray()).toEqual([{ id: 3 }]);
        expect(await db.books.where(row => row.price.gt(150).and(row.title.eq('Beta'))).select(row => ({ id: row.id })).toArray()).toEqual([{ id: 2 }]);
        expect(await db.books.where(row => row.price.gt(150).or(row.title.eq('Alpha'))).orderBy(row => row.id).select(row => ({ id: row.id })).toArray()).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    });
    it('changes projection fields, aliases and functions without retaining stale SQL', async () => {
        expect(await db.books.where(row => row.id.eq(1)).select(row => ({ value: row.title })).single()).toEqual({ value: 'Alpha' });
        expect(await db.books.where(row => row.id.eq(1)).select(row => ({ value: row.edition })).single()).toEqual({ value: null });
        expect(await db.books.where(row => row.id.eq(1)).select((row, sql) => ({ value: sql.lower(row.title) })).single()).toEqual({ value: 'alpha' });
        expect(await db.books.where(row => row.id.eq(1)).select((row, sql) => ({ value: sql.upper(row.title) })).single()).toEqual({ value: 'ALPHA' });
        expect(await db.books.where(row => row.id.eq(1)).select(row => ({ book: { title: row.title } })).single()).toEqual({ book: { title: 'Alpha' } });
        expect(await db.books.where(row => row.id.eq(2)).select(row => ({ purchase: { title: row.title } })).single()).toEqual({ purchase: { title: 'Beta' } });
    });
    it('rebinds literal and nested arithmetic values without retaining prior parameters', async () => {
        expect(await db.books.where(row => row.id.eq(1)).select((_, sql) => ({ value: sql.literal('first') })).single()).toEqual({ value: 'first' });
        expect(await db.books.where(row => row.id.eq(1)).select((_, sql) => ({ value: sql.literal('second') })).single()).toEqual({ value: 'second' });
        expect(await db.books.where(row => row.id.eq(1)).select((_, sql) => ({ value: sql.literal(null) })).single()).toEqual({ value: null });
        expect(await db.books.where(row => row.id.eq(1)).select((row, sql) => ({ value: sql.add(row.price, sql.literal(10)) })).single()).toEqual({ value: 110 });
        expect(await db.books.where(row => row.id.eq(1)).select((row, sql) => ({ value: sql.subtract(row.price, sql.literal(10)) })).single()).toEqual({ value: 90 });
        expect(await db.books.where(row => row.id.eq(1)).select((row, sql) => ({ value: sql.coalesce(row.edition, sql.literal('none')) })).single()).toEqual({ value: 'none' });
        expect(await db.books.where(row => row.id.eq(1)).select((row, sql) => ({ value: sql.coalesce(row.edition, sql.literal('missing')) })).single()).toEqual({ value: 'missing' });
    });
    it('binds complete JSON equality values after array length and object transitions', async () => {
        const values: JsonValue[] = [[1], [1, 2, 3], { edition: 'Paperback' }];
        for (const value of values) {
            expect(await db.books.where(row => row.id.eq(1)).executeUpdate({ data: value })).toBe(1);
            expect(await db.books.where(row => row.data.eq(value)).select(row => ({ id: row.id })).toArray()).toEqual([{ id: 1 }]);
        }
        expect(await db.books.where(row => row.data.eq([1])).select(row => ({ id: row.id })).toArray()).toEqual([]);
    });
}
