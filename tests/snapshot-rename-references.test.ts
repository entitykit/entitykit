import { DatabaseSync } from 'node:sqlite';
import { SchemaSqlBuilder } from '../packages/core/src/schema/schema-sql-builder';
import { applyRenameHints } from '../packages/core/src/migrations/model-diff-rename-hints';
import { cloneModelSnapshot } from '../packages/core/src/migrations/model-snapshot-clone';
import { renameSnapshotProperty } from '../packages/core/src/migrations/model-snapshot-property-rename';
import { diffModelSnapshots, MigrationSqlGenerator } from '../packages/core/src/migrations/api';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { postgresProviderServices } from '../packages/postgres/src';
import { mySqlProviderServices } from '../packages/mysql/src';
import { requireDefined } from './support/require-defined';

import { catalogModel, hints, withMixedIndex } from './support/catalog-rename-support';

describe('snapshot property renames across metadata references', () => {
    it('preserves legacy optional metadata and unrelated policy roles in a single rename', () => {
        const original = catalogModel(false).toSnapshot();
        const snapshot = {
            ...original,
            entities: original.entities.map(entity => ({
                ...entity, alternateKeys: undefined, keyProperties: undefined,
                relationships: entity.relationships.map(relationship => ({
                    ...relationship, foreignKeyProperties: undefined, principalKeyProperties: undefined,
                })),
            })),
        };
        const entity = requireDefined(snapshot.entities.find(candidate => candidate.entityName === 'CatalogItem'));
        const property = requireDefined(entity.properties.find(candidate => candidate.propertyName === 'legacyActor'));

        const renamed = renameSnapshotProperty(snapshot, entity, property, {
            ...property, propertyName: 'actor', columnName: 'actor',
        });

        const item = requireDefined(renamed.entities.find(candidate => candidate.entityName === 'CatalogItem'));
        expect(item.alternateKeys).toBeUndefined();
        expect(item.keyProperties).toBeUndefined();
        expect(item.audit).toEqual({ createdAtProperty: 'createdAt', updatedByProperty: 'actor' });
        expect(item.softDelete).toEqual(entity.softDelete);
        expect(item.tenantKeyProperty).toBe('legacyTenantId');
        expect(item.indexes).toEqual(entity.indexes.map(index => ({
            ...index,
            includedPropertyNames: index.includedPropertyNames?.map(name => name === 'legacyActor' ? 'actor' : name),
        })));
        const offer = requireDefined(renamed.entities.find(candidate => candidate.entityName === 'CatalogOffer'));
        expect(offer.relationships).toEqual(snapshot.entities.find(candidate => candidate.entityName === 'CatalogOffer')?.relationships);
        expect(entity.properties.find(candidate => candidate.propertyName === 'legacyActor')).toBe(property);
    });

    it('keeps a matching foreign-key property name in the dependent namespace during a principal rename', () => {
        const original = catalogModel(false, false).toSnapshot();
        const snapshot = {
            ...original,
            entities: original.entities.map(entity => entity.entityName === 'CatalogOffer' ? {
                ...entity,
                properties: entity.properties.map(property => property.propertyName === 'legacyBookCode'
                    ? { ...property, propertyName: 'legacyCode' } : property),
                relationships: entity.relationships.map(relationship => relationship.navigationProperty === 'book' ? {
                    ...relationship, foreignKeyProperty: 'legacyCode', foreignKeyProperties: ['legacyCode'],
                } : relationship),
            } : entity),
        };
        const entity = requireDefined(snapshot.entities.find(candidate => candidate.entityName === 'CatalogItem'));
        const property = requireDefined(entity.properties.find(candidate => candidate.propertyName === 'legacyCode'));

        const renamed = renameSnapshotProperty(snapshot, entity, property, {
            ...property, propertyName: 'code', columnName: 'code',
        });

        const offer = requireDefined(renamed.entities.find(candidate => candidate.entityName === 'CatalogOffer'));
        expect(offer.relationships.find(relationship => relationship.navigationProperty === 'book')).toEqual({
            ...snapshot.entities.find(candidate => candidate.entityName === 'CatalogOffer')?.relationships[0],
            foreignKeyProperty: 'legacyCode', foreignKeyProperties: ['legacyCode'], principalKeyProperties: ['code'],
        });
        expect(offer.properties.map(candidate => candidate.propertyName)).toEqual(['id', 'legacyCode', 'categoryId']);
    });

    it('follows keys, alternate keys, indexes, policy roles and both sides of a relationship', () => {
        const before = withMixedIndex(catalogModel(false).toSnapshot(), false);
        const after = withMixedIndex(catalogModel(true).toSnapshot(), true);
        const originalBefore = JSON.stringify(before);
        const originalAfter = JSON.stringify(after);

        const normalized = applyRenameHints(before, after, hints);

        expect(normalized.snapshot).toEqual(cloneModelSnapshot(after));
        expect(normalized.renameOperations).toHaveLength(6);
        expect(JSON.stringify(before)).toBe(originalBefore);
        expect(JSON.stringify(after)).toBe(originalAfter);
        const category = requireDefined(normalized.snapshot.entities.find(entity => entity.entityName === 'CatalogCategory'));
        expect(category.keyProperties).toEqual(['legacyId']);
        const offer = requireDefined(normalized.snapshot.entities.find(entity => entity.entityName === 'CatalogOffer'));
        expect(offer.relationships.find(row => row.navigationProperty === 'category')?.principalKeyProperties)
            .toEqual(['legacyId']);
    });

    it('produces only the six requested column renames through the public differ', () => {
        const before = catalogModel(false).toSnapshot();
        const after = catalogModel(true).toSnapshot();
        const diff = diffModelSnapshots(before, after, { renameHints: hints });
        expect(diff.operations.map(operation => operation.kind)).toEqual(Array<string>(6).fill('alterColumn'));
        for (const hint of hints.columns) {
            const operation = requireDefined(diff.operations.find(candidate =>
                candidate.kind === 'alterColumn' && candidate.tableName === hint.tableName && candidate.column.oldName === hint.from));
            if (operation.kind !== 'alterColumn') throw new Error('Expected a column rename.');
            expect(operation.column.name).toBe(hint.to);
        }
    });

    it.each([
        ['sqlite', sqliteProviderServices], ['postgres', postgresProviderServices], ['mysql', mySqlProviderServices],
    ])('renders reversible column transformations for %s', (name, provider) => {
        const migration = diffModelSnapshots(catalogModel(false, false).toSnapshot(), catalogModel(true, false).toSnapshot(), {
            renameHints: hints,
        }).toMigration('20261003000001_RenameCatalog', 'RenameCatalog');
        const generator = new MigrationSqlGenerator(provider.migrationDialect, provider.createMigrationBuilder);
        const up = generator.generateUpScript(migration);
        const down = generator.generateDownScript(migration);
        for (const sql of [up, down]) {
            expect(sql).not.toContain('drop column');
            if (name === 'sqlite') {
                expect(sql).toContain('insert into "__entitykit_new_catalog_items"');
                expect(sql).toContain('insert into "__entitykit_new_catalog_offers"');
            } else {
                expect(sql).toContain('rename column');
                expect(sql).not.toContain('drop table');
                expect(sql).not.toContain('drop index');
            }
        }
    });

    it('preserves actual SQLite rows and foreign keys through a dependent property rename and rollback', () => {
        const before = catalogModel(false, false);
        const after = catalogModel(false, false, true);
        const migration = diffModelSnapshots(before.toSnapshot(), after.toSnapshot(), {
            renameHints: { columns: [requireDefined(hints.columns.at(-1))] },
        })
            .toMigration('20261003000001_RenameCatalog', 'RenameCatalog');
        const generator = new MigrationSqlGenerator(sqliteProviderServices.migrationDialect, sqliteProviderServices.createMigrationBuilder);
        const database = new DatabaseSync(':memory:');
        try {
            database.exec('pragma foreign_keys = ON');
            database.exec(new SchemaSqlBuilder(sqliteProviderServices.dialect).build(before));
            database.prepare('insert into catalog_categories (legacy_id) values (?)').run('category');
            database.exec(`insert into catalog_items (legacy_id, legacy_code, legacy_tenant_id, legacy_actor, created_at, title)
                values ('book', 'edition', 'tenant', 'actor', '2026-10-03T00:00:00.000Z', 'Novel')`);
            database.prepare('insert into catalog_offers (id, legacy_book_code, category_id) values (?, ?, ?)')
                .run('offer', 'edition', 'category');
            database.exec(`begin; ${generator.generateUpScript(migration)} commit;`);
            expect(database.prepare('select legacy_id, legacy_code, legacy_tenant_id, legacy_actor, legacy_deleted_at, title from catalog_items').all()).toEqual([
                { legacy_id: 'book', legacy_code: 'edition', legacy_tenant_id: 'tenant', legacy_actor: 'actor', legacy_deleted_at: null, title: 'Novel' },
            ]);
            expect(database.prepare('select id, book_code, category_id from catalog_offers').all()).toEqual([
                { id: 'offer', book_code: 'edition', category_id: 'category' },
            ]);
            expect(database.prepare('pragma foreign_key_check').all()).toEqual([]);
            database.exec(`begin; ${generator.generateDownScript(migration)} commit;`);
            expect(database.prepare('select legacy_id, legacy_code, legacy_tenant_id, legacy_actor, title from catalog_items').all()).toEqual([
                { legacy_id: 'book', legacy_code: 'edition', legacy_tenant_id: 'tenant', legacy_actor: 'actor', title: 'Novel' },
            ]);
            expect(database.prepare('select legacy_book_code from catalog_offers').all()).toEqual([{ legacy_book_code: 'edition' }]);
            expect(database.prepare('pragma foreign_key_check').all()).toEqual([]);
        } finally {
            database.close();
        }
    });
});
