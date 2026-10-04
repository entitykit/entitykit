import { MigrationRunner, diffModelSnapshots } from '../../packages/core/src/migrations/api';
import { PostgresDatabaseConnection, postgresProviderServices } from '../../packages/postgres/src';
import { MySqlDatabaseConnection, mySqlProviderServices } from '../../packages/mysql/src';
import { catalogModel, hints } from '../support/catalog-rename-support';
import { requireDefined } from '../support/require-defined';

type RenameProvider = typeof postgresProviderServices | typeof mySqlProviderServices;
type RenameConnection = PostgresDatabaseConnection | MySqlDatabaseConnection;

async function qualifyRenames(provider: RenameProvider, connection: RenameConnection): Promise<void> {
    const name = provider.dialect.name;
    const marker = (index: number): string => name === 'postgres' ? `$${String(index + 1)}` : '?';
    const query = async (text: string, values: unknown[] = []): Promise<unknown> => {
        const result = await connection.query({ text, values });
        return result.rows;
    };
    const cleanup = async (): Promise<void> => {
        for (const table of ['catalog_offers', 'catalog_items', 'catalog_categories', '__entitykit_migrations']) {
            await connection.query({ text: `drop table if exists ${table}`, values: [] });
        }
    };
    try {
        await cleanup();
        const before = catalogModel(false, false).toSnapshot();
        const after = catalogModel(true, false).toSnapshot();
        const initial = diffModelSnapshots({ formatVersion: 1, entities: [] }, before)
            .toMigration('20261003000000_CreateRenameCatalog', 'CreateRenameCatalog');
        const renamed = diffModelSnapshots(before, after, { renameHints: hints })
            .toMigration('20261003000001_RenameCatalog', 'RenameCatalog');
        const runner = new MigrationRunner(connection, provider.migrationDialect, provider.createMigrationBuilder);
        await runner.update([initial, renamed], { target: initial.id });
        await query(`insert into catalog_categories (legacy_id) values (${marker(0)})`, ['category']);
        await query(`insert into catalog_items (legacy_id, legacy_code, legacy_tenant_id, legacy_actor, created_at, title)
            values (${marker(0)}, ${marker(1)}, ${marker(2)}, ${marker(3)}, current_timestamp, ${marker(4)})`,
        ['book', 'edition', 'tenant', 'actor', 'Novel']);
        await query(`insert into catalog_offers (id, legacy_book_code, category_id)
            values (${marker(0)}, ${marker(1)}, ${marker(2)})`, ['offer', 'edition', 'category']);

        await runner.update([initial, renamed]);

        expect(await query('select id, code, tenant_id, actor, deleted_at, title from catalog_items')).toEqual([
            { id: 'book', code: 'edition', tenant_id: 'tenant', actor: 'actor', deleted_at: null, title: 'Novel' },
        ]);
        expect(await query('select id, book_code, category_id from catalog_offers')).toEqual([
            { id: 'offer', book_code: 'edition', category_id: 'category' },
        ]);
        await expect(query(`insert into catalog_offers (id, book_code, category_id)
            values (${marker(0)}, ${marker(1)}, ${marker(2)})`, ['invalid', 'missing', 'category'])).rejects.toThrow();
        expect(await query('select id from catalog_offers')).toEqual([{ id: 'offer' }]);

        await runner.update([initial, renamed], { target: initial.id });

        expect(await query('select legacy_id, legacy_code, legacy_tenant_id, legacy_actor, title from catalog_items')).toEqual([
            { legacy_id: 'book', legacy_code: 'edition', legacy_tenant_id: 'tenant', legacy_actor: 'actor', title: 'Novel' },
        ]);
        expect(await query('select id, legacy_book_code, category_id from catalog_offers')).toEqual([
            { id: 'offer', legacy_book_code: 'edition', category_id: 'category' },
        ]);
        await expect(query(`insert into catalog_offers (id, legacy_book_code, category_id)
            values (${marker(0)}, ${marker(1)}, ${marker(2)})`, ['invalid', 'missing', 'category'])).rejects.toThrow();
        expect(await query('select id from catalog_offers')).toEqual([{ id: 'offer' }]);
    } finally {
        try {
            await cleanup();
        } finally {
            await connection.dispose();
        }
    }
}

const postgresUrl = process.env.DATABASE_URL;
const postgres = process.env.RUN_POSTGRES_TESTS === 'true' && postgresUrl ? describe : describe.skip;
postgres('snapshot property renames against live Postgres', () => {
    it('preserves related catalog data and constraints through renames and rollback', async () => {
        await qualifyRenames(postgresProviderServices, new PostgresDatabaseConnection(requireDefined(postgresUrl)));
    });
});

const mysqlUrl = process.env.MYSQL_URL ?? process.env.MYSQL_DATABASE_URL;
const mysql = process.env.RUN_MYSQL_TESTS === 'true' && mysqlUrl ? describe : describe.skip;
mysql('snapshot property renames against live MySQL', () => {
    it('preserves related catalog data and constraints through renames and rollback', async () => {
        await qualifyRenames(mySqlProviderServices, new MySqlDatabaseConnection(requireDefined(mysqlUrl)));
    });
});
