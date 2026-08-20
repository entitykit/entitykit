import type {
    DbContextOptionsBuilder,
    ModelBuilder,
} from '../../packages/core/src';
import {
    DbContext,
} from '../../packages/core/src';

/**
 * `contains` / `startsWith` / `endsWith` treat a literal `%` or `_` in the
 * search term as text, not a wildcard, on every provider.
 *
 * The pattern is built by wrapping the term in `%`, so a `%` or `_` the caller
 * typed used to leak through as a wildcard and silently over-match. The term is
 * now escaped and the query carries `escape '~'` (SQLite has no default escape
 * character, so the clause is required, and `~` is portable where `\` is not).
 *
 * SQLite runs in-process (unconditional); Postgres and MySQL are gated.
 */
class Item {
    public id!: string;
    public name!: string;
}

class ShopContext extends DbContext {
    public static configureProvider: (options: DbContextOptionsBuilder) => void;

    public items = this.set(Item);

    protected override configure(options: DbContextOptionsBuilder): void {
        ShopContext.configureProvider(options);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Item, entity => {
            entity.toTable('le_items');
            entity.hasKey(i => i.id);
            entity.property(i => i.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(i => i.name).hasColumnName('name').hasColumnType('text').isRequired();
        });
    }
}

function defineTests(label: string, configure: (options: DbContextOptionsBuilder) => void): void {
    describe(`LIKE wildcard escaping (${label})`, () => {
        let db: ShopContext;

        beforeEach(async () => {
            ShopContext.configureProvider = configure;
            db =  ShopContext.create();
            await db.database.connection.query({ text: 'drop table if exists le_items', values: [] });
            for (const statement of db.database.createScript().split(';').map(s => s.trim()).filter(Boolean)) {
                await db.database.connection.query({ text: statement, values: [] });
            }
            const names = ['50% off', '5000 off', 'a_b', 'axb', '100~200', 'plain'];
            let n = 0;
            for (const name of names) db.items.add(Object.assign(new Item(), { id: `i${String(n++)}`, name }));
            await db.saveChanges();
            db.changeTracker.clear();
        });

        afterEach(async () => {
            await db.database.connection.query({ text: 'drop table if exists le_items', values: [] });
            await db.dispose();
        });

        const names = async (query: Promise<Item[]>): Promise<string[]> => (await query).map(i => i.name).sort();

        it('treats % in a contains term as a literal', async () => {
            expect(await names(db.items.where(i => i.name.contains('50%')).toArray())).toEqual(['50% off']);
        });

        it('treats _ in a startsWith term as a literal', async () => {
            expect(await names(db.items.where(i => i.name.startsWith('a_')).toArray())).toEqual(['a_b']);
        });

        it('treats the escape character itself as a literal', async () => {
            // "100~200" must match despite `~` being the escape character.
            expect(await names(db.items.where(i => i.name.contains('~200')).toArray())).toEqual(['100~200']);
        });

        it('still matches an ordinary term', async () => {
            expect(await names(db.items.where(i => i.name.endsWith(' off')).toArray())).toEqual(['50% off', '5000 off']);
        });
    });
}

defineTests('SQLite', options => options.useSqlite(':memory:'));

const postgresUrl = process.env.DATABASE_URL;
if (process.env.RUN_POSTGRES_TESTS === 'true' && postgresUrl) {
    defineTests('Postgres', options => options.usePostgres(postgresUrl));
}

const mysqlUrl = process.env.MYSQL_URL ?? process.env.MYSQL_DATABASE_URL;
if (process.env.RUN_MYSQL_TESTS === 'true' && mysqlUrl) {
    defineTests('MySQL', options => options.useMySql(mysqlUrl));
}
