import type { ModelSnapshot } from '../packages/core/src/model/model-snapshot-types';
import { DeleteBehavior } from '../packages/core/src';
import {
    Migration, MigrationRunner, diffModelSnapshots,
    type MigrationBuilder,
} from '../packages/core/src/migrations/api';
import { SqliteDatabaseConnection, sqliteProviderServices } from '../packages/sqlite/src';
import { catalogModel, hints } from './support/catalog-rename-support';

function withDeleteBehavior(snapshot: ModelSnapshot, behavior: DeleteBehavior): ModelSnapshot {
    return {
        ...snapshot,
        entities: snapshot.entities.map(entity => entity.entityName === 'CatalogOffer' ? {
            ...entity,
            properties: entity.properties.map(property => property.propertyName === 'legacyBookCode'
                ? { ...property, isRequired: behavior !== DeleteBehavior.SetNull } : property),
            relationships: entity.relationships.map(relationship => relationship.navigationProperty === 'book'
                ? { ...relationship, deleteBehavior: behavior } : relationship),
        } : entity),
    };
}

function parentRebuild(snapshot: ModelSnapshot): ModelSnapshot {
    return {
        ...snapshot,
        entities: snapshot.entities.map(entity => entity.entityName === 'CatalogItem' ? {
            ...entity,
            properties: entity.properties.map(property => property.propertyName === 'title'
                ? { ...property, isRequired: false } : property),
        } : entity),
    };
}

async function query(connection: SqliteDatabaseConnection, text: string): Promise<unknown> {
    return (await connection.query({ text, values: [] })).rows;
}

async function seed(connection: SqliteDatabaseConnection): Promise<void> {
    await query(connection, 'insert into catalog_categories (legacy_id) values (\'category\')');
    await query(connection, `insert into catalog_items (legacy_id, legacy_code, legacy_tenant_id, legacy_actor, created_at, title)
        values ('book', 'edition', 'tenant', 'actor', '2026-10-03T00:00:00.000Z', 'Novel')`);
    await query(connection, 'insert into catalog_offers (id, legacy_book_code, category_id) values (\'offer\', \'edition\', \'category\')');
}

function runner(connection: SqliteDatabaseConnection): MigrationRunner {
    return new MigrationRunner(connection, sqliteProviderServices.migrationDialect, sqliteProviderServices.createMigrationBuilder);
}

const initialId = '20261004000000_CreateRebuildCatalog';
const rebuildId = '20261004000001_RebuildCatalog';

describe('SQLite migration rebuild safety', () => {
    it('renames both ends of an existing relationship and rolls back without losing rows', async () => {
        const connection = new SqliteDatabaseConnection(':memory:');
        try {
            const before = catalogModel(false, false).toSnapshot();
            const after = catalogModel(true, false).toSnapshot();
            const initial = diffModelSnapshots({ formatVersion: 1, entities: [] }, before).toMigration(initialId, 'CreateRebuildCatalog');
            const renamed = diffModelSnapshots(before, after, { renameHints: hints }).toMigration(rebuildId, 'RebuildCatalog');
            const migrations = runner(connection);
            await migrations.update([initial]);
            await seed(connection);

            await migrations.update([initial, renamed]);

            expect(await query(connection, 'select id, code, title from catalog_items')).toEqual([
                { id: 'book', code: 'edition', title: 'Novel' },
            ]);
            expect(await query(connection, 'select id, book_code, category_id from catalog_offers')).toEqual([
                { id: 'offer', book_code: 'edition', category_id: 'category' },
            ]);
            expect(await query(connection, 'pragma foreign_key_check')).toEqual([]);
            expect(await query(connection, 'pragma foreign_keys')).toEqual([{ foreign_keys: 1 }]);
            await expect(query(connection, 'insert into catalog_offers values (\'invalid\', \'missing\', \'category\')')).rejects.toThrow();

            await migrations.update([initial, renamed], { target: initial.id });

            expect(await query(connection, 'select legacy_id, legacy_code, title from catalog_items')).toEqual([
                { legacy_id: 'book', legacy_code: 'edition', title: 'Novel' },
            ]);
            expect(await query(connection, 'select id, legacy_book_code, category_id from catalog_offers')).toEqual([
                { id: 'offer', legacy_book_code: 'edition', category_id: 'category' },
            ]);
            expect(await query(connection, 'pragma foreign_key_check')).toEqual([]);
            expect(await query(connection, 'pragma foreign_keys')).toEqual([{ foreign_keys: 1 }]);
            expect((await migrations.getAppliedMigrations({ initializeHistory: false })).map(row => row.id)).toEqual([initialId]);
        } finally {
            await connection.dispose();
        }
    });

    it.each([DeleteBehavior.NoAction, DeleteBehavior.Restrict, DeleteBehavior.Cascade, DeleteBehavior.SetNull])(
        'preserves existing dependent rows while rebuilding a parent with %s', async behavior => {
            const connection = new SqliteDatabaseConnection(':memory:');
            try {
                const before = withDeleteBehavior(catalogModel(false, false).toSnapshot(), behavior);
                const after = parentRebuild(before);
                const initial = diffModelSnapshots({ formatVersion: 1, entities: [] }, before).toMigration(initialId, 'CreateRebuildCatalog');
                const rebuilt = diffModelSnapshots(before, after).toMigration(rebuildId, 'RebuildCatalog');
                const migrations = runner(connection);
                await migrations.update([initial]);
                await seed(connection);

                await migrations.update([initial, rebuilt]);

                expect(await query(connection, 'select id, legacy_book_code, category_id from catalog_offers')).toEqual([
                    { id: 'offer', legacy_book_code: 'edition', category_id: 'category' },
                ]);
                expect(await query(connection, 'pragma foreign_key_check')).toEqual([]);
                expect(await query(connection, 'pragma foreign_keys')).toEqual([{ foreign_keys: 1 }]);

                await migrations.update([initial, rebuilt], { target: initial.id });

                expect(await query(connection, 'select id, legacy_book_code, category_id from catalog_offers')).toEqual([
                    { id: 'offer', legacy_book_code: 'edition', category_id: 'category' },
                ]);
                expect(await query(connection, 'pragma foreign_key_check')).toEqual([]);
                await expect(query(connection, 'insert into catalog_offers values (\'invalid\', \'missing\', \'category\')')).rejects.toThrow();
            } finally {
                await connection.dispose();
            }
        },
    );

    it('rolls back schema, data and history if rebuilt rows violate a foreign key', async () => {
        const connection = new SqliteDatabaseConnection(':memory:');
        try {
            const before = catalogModel(false, false).toSnapshot();
            const initial = diffModelSnapshots({ formatVersion: 1, entities: [] }, before).toMigration(initialId, 'CreateRebuildCatalog');
            const rebuilt = diffModelSnapshots(before, parentRebuild(before)).toMigration(rebuildId, 'RebuildCatalog');
            class InvalidRebuild extends Migration {
                public readonly id = rebuilt.id;
                public readonly name = rebuilt.name;
                public up(builder: MigrationBuilder): void {
                    rebuilt.up(builder);
                    builder.sql('update catalog_offers set legacy_book_code = \'missing\' where id = \'offer\'');
                }
                public override down(builder: MigrationBuilder): void {
                    rebuilt.down(builder);
                }
            }
            const migrations = runner(connection);
            await migrations.update([initial]);
            await seed(connection);

            await expect(migrations.update([initial, new InvalidRebuild()])).rejects.toMatchObject({
                name: 'MigrationExecutionError',
                cause: {
                    name: 'MigrationError',
                    message: 'SQLite table rebuild would leave foreign-key violations.',
                    details: { foreignKeyViolations: [{ table: 'catalog_offers', rowid: 1, parent: 'catalog_items', fkid: 1 }] },
                },
            });

            expect(await query(connection, 'select id, legacy_book_code from catalog_offers')).toEqual([
                { id: 'offer', legacy_book_code: 'edition' },
            ]);
            expect(await query(connection, 'select title from catalog_items')).toEqual([{ title: 'Novel' }]);
            expect(await query(connection, 'pragma foreign_key_check')).toEqual([]);
            expect(await query(connection, 'pragma foreign_keys')).toEqual([{ foreign_keys: 1 }]);
            expect((await migrations.getAppliedMigrations({ initializeHistory: false })).map(row => row.id)).toEqual([initialId]);
            await expect(query(connection, 'update catalog_items set title = null')).rejects.toThrow();
            await expect(query(connection, 'insert into catalog_offers values (\'invalid\', \'missing\', \'category\')')).rejects.toThrow();
        } finally {
            await connection.dispose();
        }
    });
});
