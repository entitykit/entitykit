import { MigrationRunner, MigrationSqlGenerator, diffModelSnapshots } from '../packages/core/src/migrations/api';
import { SqliteDatabaseConnection, sqliteProviderServices } from '../packages/sqlite/src';
import { planningRows, planningSnapshot } from './support/sqlite-planning-support';

describe('SQLite rebuilds with explicit rename chains', () => {
    it.each([
        { vacated: 'note', label: 'note', note: 'memo', first: { from: 'note', to: 'memo' }, second: { from: 'label', to: 'note' } },
        { vacated: 'label', label: 'caption', note: 'label', first: { from: 'label', to: 'caption' }, second: { from: 'note', to: 'label' } },
    ])('preserves populated values and rollback when reusing $vacated', async ({ label, note, first, second }) => {
        const before = planningSnapshot({ note: 'plain' });
        const after = {
            ...before,
            entities: before.entities.map(entity => ({
                ...entity,
                properties: entity.properties.map(property => property.propertyName === 'label'
                    ? { ...property, columnName: label }
                    : property.propertyName === 'note' ? { ...property, columnName: note } : property),
            })),
        };
        const columns = [
            { tableName: 'planning_records', ...first },
            { tableName: 'planning_records', ...second },
        ];
        const diff = diffModelSnapshots(before, after, { renameHints: { columns } });
        const initial = diffModelSnapshots({ formatVersion: 1, entities: [] }, before)
            .toMigration('20261004001000_CreateRenameChain', 'CreateRenameChain');
        const changed = diff.toMigration('20261004001001_RenameChain', 'RenameChain');
        const generator = new MigrationSqlGenerator(sqliteProviderServices.migrationDialect, sqliteProviderServices.createMigrationBuilder);
        const up = generator.buildUpStatements(changed).map(statement => statement.text).join('\n');
        const down = generator.buildDownStatements(changed).map(statement => statement.text).join('\n');
        const connection = new SqliteDatabaseConnection(':memory:');
        const runner = new MigrationRunner(connection, sqliteProviderServices.migrationDialect, sqliteProviderServices.createMigrationBuilder);
        try {
            await runner.update([initial]);
            await planningRows(connection, 'insert into planning_records (id, label, note) values (1, \'label value\', \'note value\')');
            await runner.update([initial, changed]);
            expect(await planningRows(connection, 'select * from planning_records')).toEqual([
                { id: 1, [label]: 'label value', [note]: 'note value' },
            ]);
            await runner.update([initial, changed], { target: initial.id });
            expect(await planningRows(connection, 'select * from planning_records')).toEqual([
                { id: 1, label: 'label value', note: 'note value' },
            ]);
            expect((await runner.getAppliedMigrations({ initializeHistory: false })).map(row => row.id)).toEqual([initial.id]);
            expect(up).toContain('select "id", "label", "note" from "planning_records"');
            expect(down).toContain(`select "id", "${label}", "${note}" from "planning_records"`);
        } finally {
            await connection.dispose();
        }
    });
});
