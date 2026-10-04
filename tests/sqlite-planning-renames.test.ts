import type { ModelSnapshot } from '../packages/core/src/model/model-snapshot-types';
import { MigrationRunner, MigrationSqlGenerator, diffModelSnapshots } from '../packages/core/src/migrations/api';
import { SqliteDatabaseConnection, sqliteProviderServices } from '../packages/sqlite/src';
import { principalSnapshot } from './support/principal-column-rename-support';
import { planningRows, planningSnapshot, qualifyPlanningPair } from './support/sqlite-planning-support';

describe('SQLite rebuild rename and dependency planning', () => {
    it('copies a stable mapped property when its physical column changes without a rename hint', async () => {
        const before = planningSnapshot();
        const after = { ...before, entities: before.entities.map(entity => ({
            ...entity, properties: entity.properties.map(property => property.propertyName === 'label'
                ? { ...property, columnName: 'caption' } : property),
        })) };
        await qualifyPlanningPair(before, after, async (connection, direction) => {
            const column = direction === 'up' ? 'caption' : 'label';
            expect(await planningRows(connection, `select id, ${column} from planning_records`)).toEqual([{ id: 7, [column]: 'Novel' }]);
        });
    });

    it('preserves a property refactor with a stable physical column during an unrelated rebuild', async () => {
        const before = planningSnapshot();
        const nullable = planningSnapshot({ optionalLabel: true });
        const after = {
            ...nullable,
            entities: nullable.entities.map(entity => ({
                ...entity,
                properties: entity.properties.map(property => property.propertyName === 'label'
                    ? { ...property, propertyName: 'caption' } : property),
            })),
        };

        await qualifyPlanningPair(before, after, async connection => {
            expect(await planningRows(connection, 'select id, label from planning_records')).toEqual([{ id: 7, label: 'Novel' }]);
        });
    });

    it('preserves physical column values when mapped property names exchange places during a rebuild', async () => {
        const before = planningSnapshot();
        const nullable = planningSnapshot({ optionalLabel: true });
        const after = {
            ...nullable,
            entities: nullable.entities.map(entity => ({
                ...entity,
                keyProperty: 'label',
                keyProperties: ['label'],
                properties: entity.properties.map(property => ({ ...property,
                    propertyName: property.propertyName === 'id' ? 'label' : 'id' })),
            })),
        };
        await qualifyPlanningPair(before, after, async connection => {
            expect(await planningRows(connection, 'select id, label from planning_records')).toEqual([{ id: 7, label: 'Novel' }]);
        });
    });

    it.each([undefined, 'main'])('renames and rebuilds a referenced table in schema %s without losing its dependent', async schema => {
        const before: ModelSnapshot = {
            ...principalSnapshot('primary', false),
            entities: principalSnapshot('primary', false).entities.map(entity => ({ ...entity, schemaName: schema })),
        };
        const after: ModelSnapshot = {
            ...before,
            entities: before.entities.map(entity => entity.entityName === 'CatalogEntry' ? {
                ...entity,
                entityName: 'CatalogEdition',
                tableName: 'catalog_editions',
                properties: entity.properties.map(property => property.propertyName === 'label' ? { ...property, isRequired: false } : property),
            } : {
                ...entity,
                relationships: entity.relationships.map(relationship => ({ ...relationship, principalEntityName: 'CatalogEdition' })),
            }),
        };
        const initialShape = { ...before, entities: before.entities.map(entity => ({ ...entity, schemaName: undefined })) };
        const initial = diffModelSnapshots({ formatVersion: 1, entities: [] }, initialShape).toMigration('20261004000100_CreatePlanningRecord', 'CreatePlanningRecord');
        const changed = diffModelSnapshots(before, after, {
            renameHints: { tables: [{ from: 'catalog_entries', to: 'catalog_editions', schemaName: schema }] },
        }).toMigration('20261004000101_ChangePlanningRecord', 'ChangePlanningRecord');
        const connection = new SqliteDatabaseConnection(':memory:');
        const runner = new MigrationRunner(connection, sqliteProviderServices.migrationDialect, sqliteProviderServices.createMigrationBuilder);
        try {
            await runner.update([initial]);
            await planningRows(connection, 'insert into catalog_entries values (\'edition\', \'tenant\', \'Novel\')');
            await planningRows(connection, 'insert into catalog_links values (\'link\', \'edition\', \'tenant\')');
            for (const direction of ['up', 'down'] as const) {
                await runner.update([initial, changed], direction === 'up' ? { allowDataLoss: true } : { target: initial.id });
                const table = direction === 'up' ? 'catalog_editions' : 'catalog_entries';
                expect(await planningRows(connection, `select * from ${table}`)).toEqual([{ legacy_id: 'edition', tenant: 'tenant', label: 'Novel' }]);
                expect(await planningRows(connection, 'select * from catalog_links')).toEqual([{ id: 'link', owner_key: 'edition', owner_tenant: 'tenant' }]);
                expect(await planningRows(connection, 'pragma foreign_key_check')).toEqual([]);
                await expect(planningRows(connection, 'insert into catalog_links values (\'invalid\', \'missing\', \'tenant\')')).rejects.toThrow();
            }
        } finally {
            await connection.dispose();
        }
    });

    it('matches simultaneous column renames to their own table before copying populated rows', async () => {
        const record = planningSnapshot().entities[0];
        const before: ModelSnapshot = {
            formatVersion: 1,
            entities: [
                { ...record, entityName: 'ArchivedRecord', tableName: 'archived_records', properties: record.properties.map(property =>
                    property.propertyName === 'label' ? { ...property, propertyName: 'title', columnName: 'title' } : property) },
                record,
            ],
        };
        const after = {
            ...before,
            entities: before.entities.map(entity => ({ ...entity, properties: entity.properties.map(property => property.isPrimaryKey
                ? property : { ...property, propertyName: 'caption', columnName: 'caption' }) })),
        };
        const initial = diffModelSnapshots({ formatVersion: 1, entities: [] }, before).toMigration('20261004000100_CreatePlanningRecord', 'CreatePlanningRecord');
        const changed = diffModelSnapshots(before, after, { renameHints: { columns: [
            { tableName: 'archived_records', from: 'title', to: 'caption' },
            { tableName: 'planning_records', from: 'label', to: 'caption' },
        ] } }).toMigration('20261004000101_ChangePlanningRecord', 'ChangePlanningRecord');
        const connection = new SqliteDatabaseConnection(':memory:');
        const runner = new MigrationRunner(connection, sqliteProviderServices.migrationDialect, sqliteProviderServices.createMigrationBuilder);
        try {
            await runner.update([initial]);
            await planningRows(connection, 'insert into archived_records values (1, \'Archive\')');
            await planningRows(connection, 'insert into planning_records values (2, \'Current\')');
            await runner.update([initial, changed]);
            expect(await planningRows(connection, 'select * from archived_records')).toEqual([{ id: 1, caption: 'Archive' }]);
            expect(await planningRows(connection, 'select * from planning_records')).toEqual([{ id: 2, caption: 'Current' }]);
            await runner.update([initial, changed], { target: initial.id });
            expect(await planningRows(connection, 'select * from archived_records')).toEqual([{ id: 1, title: 'Archive' }]);
            expect(await planningRows(connection, 'select * from planning_records')).toEqual([{ id: 2, label: 'Current' }]);
        } finally {
            await connection.dispose();
        }
    });

    it('rebuilds an existing dependent before removing its former principal', async () => {
        const before = principalSnapshot('primary', false);
        const after = { ...before, entities: before.entities.filter(entity => entity.entityName === 'CatalogLink')
            .map(entity => ({ ...entity, relationships: [] })) };
        const initial = diffModelSnapshots({ formatVersion: 1, entities: [] }, before).toMigration('20261004000100_CreatePlanningRecord', 'CreatePlanningRecord');
        const changed = diffModelSnapshots(before, after).toMigration('20261004000101_ChangePlanningRecord', 'ChangePlanningRecord');
        const generator = new MigrationSqlGenerator(sqliteProviderServices.migrationDialect, sqliteProviderServices.createMigrationBuilder);
        const up = generator.generateUpScript(changed);
        expect(up.indexOf('insert into "__entitykit_new_catalog_links"')).toBeLessThan(up.indexOf('drop table if exists "catalog_entries"'));
        const connection = new SqliteDatabaseConnection(':memory:');
        const runner = new MigrationRunner(connection, sqliteProviderServices.migrationDialect, sqliteProviderServices.createMigrationBuilder);
        try {
            await runner.update([initial]);
            await planningRows(connection, 'insert into catalog_entries values (\'edition\', \'tenant\', \'Novel\')');
            await planningRows(connection, 'insert into catalog_links values (\'link\', \'edition\', \'tenant\')');
            await runner.update([initial, changed], { allowDataLoss: true });
            expect(await planningRows(connection, 'select * from catalog_links')).toEqual([{ id: 'link', owner_key: 'edition', owner_tenant: 'tenant' }]);
            expect(await planningRows(connection, 'pragma foreign_key_list(catalog_links)')).toEqual([]);
            await expect(planningRows(connection, 'select * from catalog_entries')).rejects.toThrow();
        } finally {
            await connection.dispose();
        }
    });
});
