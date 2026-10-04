import {
    MigrationRunner, MigrationSqlGenerator, diffModelSnapshots,
} from '../packages/core/src/migrations/api';
import { SqliteDatabaseConnection, sqliteProviderServices } from '../packages/sqlite/src';
import { postgresProviderServices } from '../packages/postgres/src';
import { mySqlProviderServices } from '../packages/mysql/src';
import { catalogModel } from './support/catalog-rename-support';
import { principalRenameHint, principalSnapshot } from './support/principal-column-rename-support';

describe('SQLite dependent planning after a principal column rename', () => {
    it.each(['primary', 'alternate', 'composite'] as const)(
        'preserves a populated dependent with an unchanged foreign property after renaming its %s key', async kind => {
            const connection = new SqliteDatabaseConnection(':memory:');
            const query = async (text: string): Promise<unknown> => (await connection.query({ text, values: [] })).rows;
            try {
                const before = principalSnapshot(kind, false);
                const after = principalSnapshot(kind, true);
                const hint = principalRenameHint(kind);
                const initial = diffModelSnapshots({ formatVersion: 1, entities: [] }, before)
                    .toMigration('20261004000010_CreatePrincipalCatalog', 'CreatePrincipalCatalog');
                const diff = diffModelSnapshots(before, after, { renameHints: { columns: [hint] } });
                expect(diff.operations.map(operation => operation.kind)).toEqual(['alterColumn']);
                const renamed = diff.toMigration('20261004000011_RenamePrincipalCatalog', 'RenamePrincipalCatalog');
                const runner = new MigrationRunner(connection, sqliteProviderServices.migrationDialect, sqliteProviderServices.createMigrationBuilder);
                await runner.update([initial]);
                await query(kind === 'alternate'
                    ? 'insert into catalog_entries (id, legacy_code, tenant, label) values (\'entry\', \'edition\', \'tenant\', \'Novel\')'
                    : 'insert into catalog_entries (legacy_id, tenant, label) values (\'edition\', \'tenant\', \'Novel\')');
                await query('insert into catalog_links (id, owner_key, owner_tenant) values (\'link\', \'edition\', \'tenant\')');

                await runner.update([initial, renamed]);

                expect(await query(`select ${hint.to}, tenant, label from catalog_entries`)).toEqual([
                    { [hint.to]: 'edition', tenant: 'tenant', label: 'Novel' },
                ]);
                expect(await query('select * from catalog_links')).toEqual([
                    { id: 'link', owner_key: 'edition', owner_tenant: 'tenant' },
                ]);
                expect(await query('pragma foreign_key_check')).toEqual([]);
                expect(await query('pragma foreign_keys')).toEqual([{ foreign_keys: 1 }]);
                await expect(query('insert into catalog_links values (\'invalid\', \'missing\', \'tenant\')')).rejects.toThrow();

                await runner.update([initial, renamed], { target: initial.id });

                expect(await query(`select ${hint.from}, tenant, label from catalog_entries`)).toEqual([
                    { [hint.from]: 'edition', tenant: 'tenant', label: 'Novel' },
                ]);
                expect(await query('select * from catalog_links')).toEqual([
                    { id: 'link', owner_key: 'edition', owner_tenant: 'tenant' },
                ]);
                expect(await query('pragma foreign_key_check')).toEqual([]);
                await expect(query('insert into catalog_links values (\'invalid\', \'missing\', \'tenant\')')).rejects.toThrow();
                expect((await runner.getAppliedMigrations({ initializeHistory: false })).map(row => row.id)).toEqual([initial.id]);
            } finally {
                await connection.dispose();
            }
        },
    );

    it.each([
        ['postgres', postgresProviderServices], ['mysql', mySqlProviderServices],
    ])('preserves native %s column-rename SQL without replacing dependent tables', (_name, provider) => {
        const migration = diffModelSnapshots(principalSnapshot('alternate', false), principalSnapshot('alternate', true), {
            renameHints: { columns: [principalRenameHint('alternate')] },
        }).toMigration('20261004000011_RenamePrincipalCatalog', 'RenamePrincipalCatalog');
        const generator = new MigrationSqlGenerator(provider.migrationDialect, provider.createMigrationBuilder);

        for (const script of [generator.generateUpScript(migration), generator.generateDownScript(migration)]) {
            expect(script).toContain('rename column');
            expect(script).not.toContain('drop table');
            expect(script).not.toContain('create table "__entitykit_new_');
            expect(script).not.toContain('catalog_links');
        }
    });

    it('keeps a dependent table in place when an unreferenced principal column changes', () => {
        const before = principalSnapshot('alternate', false);
        const after = {
            ...before,
            entities: before.entities.map(entity => entity.entityName === 'CatalogEntry' ? {
                ...entity,
                properties: entity.properties.map(property => property.propertyName === 'label'
                    ? { ...property, isRequired: false } : property),
            } : entity),
        };
        const migration = diffModelSnapshots(before, after).toMigration('20261004000012_OptionalLabel', 'OptionalLabel');
        const generator = new MigrationSqlGenerator(sqliteProviderServices.migrationDialect, sqliteProviderServices.createMigrationBuilder);

        expect(generator.generateUpScript(migration)).toContain('create table "__entitykit_new_catalog_entries"');
        expect(generator.generateUpScript(migration)).not.toContain('__entitykit_new_catalog_links');
    });

    it('ignores foreign-key declaration order when the physical schema is unchanged', () => {
        const before = catalogModel(false, false).toSnapshot();
        const after = {
            ...before,
            entities: before.entities.map(entity => ({ ...entity, relationships: [...entity.relationships].reverse() })),
        };
        const diff = diffModelSnapshots(before, after);
        expect(diff.operations).toEqual([]);
        const migration = diff.toMigration('20261004000013_ReorderedRelationships', 'ReorderedRelationships');
        const generator = new MigrationSqlGenerator(sqliteProviderServices.migrationDialect, sqliteProviderServices.createMigrationBuilder);

        expect(generator.generateUpScript(migration)).not.toContain('__entitykit_new_');
        expect(generator.generateDownScript(migration)).not.toContain('__entitykit_new_');
    });

    it.each(['before', 'after', 'both'] as const)('keeps view ownership outside dependent rebuilding when a view appears %s the change', viewAt => {
        const viewSnapshot = (renamed: boolean, view: boolean): ReturnType<typeof principalSnapshot> => {
            const snapshot = principalSnapshot('alternate', renamed);
            return { ...snapshot, entities: snapshot.entities.map(entity => entity.entityName === 'CatalogLink' && view ? {
                ...entity, isView: true, isKeyless: true, keyProperty: undefined, keyProperties: [],
                properties: entity.properties.map(property => ({ ...property, isPrimaryKey: false })),
            } : entity) };
        };
        const migration = diffModelSnapshots(viewSnapshot(false, viewAt !== 'after'), viewSnapshot(true, viewAt !== 'before'), {
            renameHints: { columns: [principalRenameHint('alternate')] },
        }).toMigration('20261004000014_RenameWithExternalView', 'RenameWithExternalView');
        const generator = new MigrationSqlGenerator(sqliteProviderServices.migrationDialect, sqliteProviderServices.createMigrationBuilder);

        expect(generator.generateUpScript(migration)).not.toContain('__entitykit_new_catalog_links');
        expect(generator.generateDownScript(migration)).not.toContain('__entitykit_new_catalog_links');
    });
});
