import { contextMigrations, diffModelSnapshots, MigrationSqlGenerator } from '../packages/core/src/migrations/api';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { postgresProviderServices } from '../packages/postgres/src';
import { mySqlProviderServices } from '../packages/mysql/src';
import { expectJoinCatalog, joinRows, JoinRenameContext, seedJoinCatalog, type JoinRenameOptions } from './support/join-principal-rename-support';

const cases = [undefined, 'main', 'MAIN'].flatMap(schema => [false, true].flatMap(composite =>
    ['source', 'target', 'both'].map(side => ({ schema, composite, side }))));

describe('SQLite join-table references after principal key renames', () => {
    it.each(cases)('preserves associations and named constraints for $side keys, composite=$composite, schema=$schema', async settings => {
        const renamed: JoinRenameOptions = {
            ...settings, sourceRenamed: settings.side !== 'target', targetRenamed: settings.side !== 'source',
        };
        const context = JoinRenameContext.create(settings);
        const target = JoinRenameContext.create(renamed);
        try {
            const migrations = contextMigrations(context);
            const before = migrations.createModelSnapshot();
            const after = contextMigrations(target).createModelSnapshot();
            const initial = diffModelSnapshots({ formatVersion: 1, entities: [] }, before)
                .toMigration('20261004001100_CreateJoinCatalog', 'CreateJoinCatalog');
            const columns = [
                ...renamed.sourceRenamed ? [{ schemaName: settings.schema, tableName: 'join_entries', from: 'legacy_id', to: 'entry_key' }] : [],
                ...renamed.targetRenamed ? [{ schemaName: settings.schema, tableName: 'join_tags', from: 'legacy_id', to: 'tag_key' }] : [],
            ];
            const diff = diffModelSnapshots(before, after, { renameHints: { columns } });
            expect(diff.operations.map(operation => operation.kind)).toEqual(columns.map(() => 'alterColumn'));
            const rename = diff.toMigration('20261004001101_RenameJoinKeys', 'RenameJoinKeys');
            await migrations.update([initial]);
            await seedJoinCatalog(context, settings.composite);
            await expectJoinCatalog(context, settings);

            await migrations.update([initial, rename]);

            await expectJoinCatalog(context, renamed);
            const generator = new MigrationSqlGenerator(sqliteProviderServices.migrationDialect, sqliteProviderServices.createMigrationBuilder);
            expect(generator.generateUpScript(rename)).toContain('__entitykit_new_join_entry_tags');
            expect(generator.generateDownScript(rename)).toContain('__entitykit_new_join_entry_tags');

            const rollback = await migrations.update([initial, rename], { target: initial.id });

            await expectJoinCatalog(context, settings);
            expect(rollback.appliedMigrations).toEqual([`down:${rename.id}`]);
            await migrations.update([initial, rename], { target: '0' });
            expect(await joinRows(context, 'select name from sqlite_master where name like \'join_%\'' )).toEqual([]);
        } finally {
            await context.dispose();
            await target.dispose();
        }
    });

    it.each([
        ['postgres', postgresProviderServices], ['mysql', mySqlProviderServices],
    ])('retains native %s key renames without replacing a join table', async (_name, provider) => {
        const before = JoinRenameContext.create();
        const after = JoinRenameContext.create({ sourceRenamed: true });
        try {
            const rename = diffModelSnapshots(contextMigrations(before).createModelSnapshot(), contextMigrations(after).createModelSnapshot(), {
                renameHints: { columns: [{ tableName: 'join_entries', from: 'legacy_id', to: 'entry_key' }] },
            }).toMigration('20261004001101_RenameJoinKeys', 'RenameJoinKeys');
            const generator = new MigrationSqlGenerator(provider.migrationDialect, provider.createMigrationBuilder);
            for (const script of [generator.generateUpScript(rename), generator.generateDownScript(rename)]) {
                expect(script).toContain('rename column');
                expect(script).not.toContain('join_entry_tags');
                expect(script).not.toContain('drop table');
            }
        } finally {
            await before.dispose();
            await after.dispose();
        }
    });
});
