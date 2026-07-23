import { requireDefined } from '../support/require-defined';
import type {
    DbContextOptionsBuilder,
    ModelBuilder } from '../../src';
import {
    DbContext,
    type IncludeDiagnosticEvent,
    type RuntimeDiagnosticEvent,
} from '../../src';

/**
 * Windowed-batch filtered includes against live engines.
 *
 * A filtered include that carries its own `take`/`skip` pages each parent's
 * children with `row_number() over (partition by ... order by ...)` in a single
 * query. That was gated to Postgres by dialect name; it is now gated on the
 * dialect declaring `supportsWindowFunctions`, which Postgres, SQLite (>= 3.25),
 * and MySQL (>= 8.0) all do. This proves the batched path actually executes on
 * each engine, returns the correct per-parent top-N, and — critically — ranks
 * nulls identically (SQL-standard, high) across all three, where the raw
 * per-engine default would otherwise disagree.
 *
 * SQLite runs in-process, so it runs unconditionally. Postgres and MySQL are
 * gated on their integration env, matching the other integration suites.
 */
class Author {
    public id!: string;
    public name!: string;
    public books!: Book[];
}
class Book {
    public id!: string;
    public title!: string;
    public authorId!: string | null;
    public rank!: number | null;
    public author!: Author | null;
    public categories!: Category[];
}
class Category {
    public id!: string;
    public label!: string;
    public ord!: number;
    public weight!: number | null;
    public books!: Book[];
}

const events: RuntimeDiagnosticEvent[] = [];

class BlogContext extends DbContext {
    public static configureProvider: (options: DbContextOptionsBuilder) => void;

    public authors = this.set(Author);
    public books = this.set(Book);
    public categories = this.set(Category);

    protected override configure(options: DbContextOptionsBuilder): void {
        BlogContext.configureProvider(options);
        options.useDiagnostics(event => events.push(event));
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Author, entity => {
            entity.toTable('fip_authors');
            entity.hasKey(a => a.id);
            entity.property(a => a.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(a => a.name).hasColumnName('name').hasColumnType('text').isRequired();
        });
        model.entity(Book, entity => {
            entity.toTable('fip_books');
            entity.hasKey(b => b.id);
            entity.property(b => b.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(b => b.title).hasColumnName('title').hasColumnType('text').isRequired();
            entity.property(b => b.authorId).hasColumnName('author_id').hasColumnType('text');
            entity.property(b => b.rank).hasColumnName('rank').hasColumnType('integer');
            entity.hasOne(Author, b => b.author).withMany(a => a.books).hasForeignKey(b => b.authorId);
            entity.hasManyToMany(Category, b => b.categories)
                .withMany(c => c.books)
                .usingJoinTable('fip_book_categories', join => {
                    join.sourceForeignKey('book_id');
                    join.targetForeignKey('category_id');
                });
        });
        model.entity(Category, entity => {
            entity.toTable('fip_categories');
            entity.hasKey(c => c.id);
            entity.property(c => c.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(c => c.label).hasColumnName('label').hasColumnType('text').isRequired();
            entity.property(c => c.ord).hasColumnName('ord').hasColumnType('integer').isRequired();
            entity.property(c => c.weight).hasColumnName('weight').hasColumnType('integer');
        });
    }
}

const tables = ['fip_book_categories', 'fip_books', 'fip_categories', 'fip_authors'];

function lastStrategy(nav: string): string {
    const forNav = events.filter(
        (e): e is IncludeDiagnosticEvent => e.kind === 'include' && e.navigationProperty === nav,
    );
    return forNav[forNav.length - 1]?.strategy ?? '(none)';
}

function defineParityTests(label: string, configure: (options: DbContextOptionsBuilder) => void): void {
    describe(`windowed filtered-include parity (${label})`, () => {
        let db: BlogContext;

        beforeEach(async () => {
            events.length = 0;
            BlogContext.configureProvider = configure;
            db =  BlogContext.create();
            for (const table of tables) {
                await db.database.connection.query({ text: `drop table if exists ${table}`, values: [] });
            }
            for (const statement of db.database.createScript().split(';').map(s => s.trim()).filter(Boolean)) {
                await db.database.connection.query({ text: statement, values: [] });
            }

            db.authors.add(Object.assign(new Author(), { id: 'a1', name: 'Ann' }));
            db.authors.add(Object.assign(new Author(), { id: 'a2', name: 'Bob' }));
            db.books.add(Object.assign(new Book(), { id: 'k1', title: 'K1', authorId: 'a1', rank: 3 }));
            db.books.add(Object.assign(new Book(), { id: 'k2', title: 'K2', authorId: 'a1', rank: 1 }));
            db.books.add(Object.assign(new Book(), { id: 'k3', title: 'K3', authorId: 'a1', rank: 2 }));
            db.books.add(Object.assign(new Book(), { id: 'k4', title: 'K4', authorId: 'a1', rank: null }));
            db.books.add(Object.assign(new Book(), { id: 'k5', title: 'K5', authorId: 'a2', rank: 1 }));
            db.books.add(Object.assign(new Book(), { id: 'k6', title: 'K6', authorId: 'a2', rank: 2 }));
            db.categories.add(Object.assign(new Category(), { id: 'c1', label: 'C1', ord: 10, weight: 2 }));
            db.categories.add(Object.assign(new Category(), { id: 'c2', label: 'C2', ord: 20, weight: 1 }));
            db.categories.add(Object.assign(new Category(), { id: 'c3', label: 'C3', ord: 30, weight: null }));
            await db.saveChanges();

            const k1 = await db.books.find('k1');
            const k2 = await db.books.find('k2');
            for (const cid of ['c1', 'c2', 'c3']) db.link(requireDefined(k1), b => b.categories, requireDefined(await db.categories.find(cid)));
            for (const cid of ['c1', 'c2']) db.link(requireDefined(k2), b => b.categories, requireDefined(await db.categories.find(cid)));
            await db.saveChanges();
            db.changeTracker.clear();
        });

        afterEach(async () => {
            for (const table of tables) {
                await db.database.connection.query({ text: `drop table if exists ${table}`, values: [] });
            }
            await db.dispose();
        });

        it('pages a one-to-many include per parent with a single windowed query', async () => {
            const take = await db.authors
                .include(a => a.books.orderBy(b => b.title).take(2))
                .orderBy(a => a.id)
                .toArray();
            expect(lastStrategy('books')).toBe('windowedBatch');
            expect(take.map(a => a.books.map(b => b.id))).toEqual([['k1', 'k2'], ['k5', 'k6']]);

            db.changeTracker.clear();
            const paged = await db.authors
                .include(a => a.books.orderBy(b => b.title).skip(1).take(2))
                .orderBy(a => a.id)
                .toArray();
            expect(lastStrategy('books')).toBe('windowedBatch');
            expect(paged.map(a => a.books.map(b => b.id))).toEqual([['k2', 'k3'], ['k6']]);
        });

        it('pages a many-to-many include per parent with a single windowed query', async () => {
            const books = await db.books
                .where(b => b.id.eq('k1').or(b.id.eq('k2')))
                .include(b => b.categories.orderBy(c => c.ord).take(2))
                .orderBy(b => b.id)
                .toArray();
            expect(lastStrategy('categories')).toBe('windowedBatch');
            expect(books.map(b => b.categories.map(c => c.id))).toEqual([['c1', 'c2'], ['c1', 'c2']]);
        });

        it('orders a batch many-to-many include by a nullable key with nulls SQL-standard', async () => {
            // No take/skip, so this is the split-query batch path, not the window.
            const books = await db.books
                .where(b => b.id.eq('k1'))
                .include(b => b.categories.orderBy(c => c.weight))
                .toArray();
            expect(lastStrategy('categories')).toBe('splitQuery');
            // Ascending by weight: 1, 2, then null last — identical on every provider,
            // matching what a top-level `orderBy(weight)` produces.
            expect(books[0]?.categories.map(c => c.id)).toEqual(['c2', 'c1', 'c3']);
        });

        it('ranks nulls SQL-standard (high) inside the per-parent window', async () => {
            const asc = await db.authors
                .where(a => a.id.eq('a1'))
                .include(a => a.books.orderBy(b => b.rank).take(2))
                .toArray();
            expect(lastStrategy('books')).toBe('windowedBatch');
            // Ascending: nulls sort last, so the two lowest non-null ranks win.
            expect(asc[0]?.books.map(b => b.id)).toEqual(['k2', 'k3']);

            db.changeTracker.clear();
            const desc = await db.authors
                .where(a => a.id.eq('a1'))
                .include(a => a.books.orderByDescending(b => b.rank).take(2))
                .toArray();
            expect(lastStrategy('books')).toBe('windowedBatch');
            // Descending: nulls sort first, then the highest non-null rank.
            expect(desc[0]?.books.map(b => b.id)).toEqual(['k4', 'k1']);
        });
    });
}

defineParityTests('SQLite', options => options.useSqlite(':memory:'));

const postgresUrl = process.env.DATABASE_URL;
if (process.env.RUN_POSTGRES_TESTS === 'true' && postgresUrl) {
    defineParityTests('Postgres', options => options.usePostgres(postgresUrl));
}

const mysqlUrl = process.env.MYSQL_URL ?? process.env.MYSQL_DATABASE_URL;
if (process.env.RUN_MYSQL_TESTS === 'true' && mysqlUrl) {
    defineParityTests('MySQL', options => options.useMySql(mysqlUrl));
}
