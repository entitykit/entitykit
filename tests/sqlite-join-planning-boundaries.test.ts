import { collectDestructiveWarnings, contextMigrations, diffModelSnapshots, MigrationSqlGenerator } from '../packages/core/src/migrations/api';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { postgresProviderServices } from '../packages/postgres/src';
import { mySqlProviderServices } from '../packages/mysql/src';
import { expectJoinCatalog, joinRows, joinSnapshot, JoinRenameContext, seedJoinCatalog } from './support/join-principal-rename-support';

const sqliteGenerator = new MigrationSqlGenerator(sqliteProviderServices.migrationDialect, sqliteProviderServices.createMigrationBuilder);

describe('stable join-table planning boundaries', () => {
    it('emits no schema SQL for an unchanged joined catalog', async () => {
        const before = await joinSnapshot();
        const diff = diffModelSnapshots(before, await joinSnapshot());
        expect(diff.hasChanges).toBe(false);
        expect(diff.operations).toEqual([]);
        const migration = diff.toMigration('20261004001200_UnchangedJoin', 'UnchangedJoin');
        expect(sqliteGenerator.generateUpScript(migration)).not.toContain('join_');
        expect(sqliteGenerator.generateDownScript(migration)).not.toContain('join_');
    });

    it('preserves a join table in place while rebuilding an unrelated principal facet', async () => {
        const context = JoinRenameContext.create();
        try {
            const before = contextMigrations(context).createModelSnapshot();
            const after = await joinSnapshot({ optionalLabel: true });
            const initial = diffModelSnapshots({ formatVersion: 1, entities: [] }, before)
                .toMigration('20261004001201_CreateUnchangedJoin', 'CreateUnchangedJoin');
            const changed = diffModelSnapshots(before, after).toMigration('20261004001202_OptionalJoinLabel', 'OptionalJoinLabel');
            const migrations = contextMigrations(context);
            await migrations.update([initial]);
            await seedJoinCatalog(context, false);
            await migrations.update([initial, changed]);
            await expectJoinCatalog(context, {});
            for (const script of [sqliteGenerator.generateUpScript(changed), sqliteGenerator.generateDownScript(changed)]) {
                expect(script).toContain('__entitykit_new_join_entries');
                expect(script).not.toContain('__entitykit_new_join_entry_tags');
            }
            await migrations.update([initial, changed], { target: initial.id });
            await expectJoinCatalog(context, {});
        } finally {
            await context.dispose();
        }
    });

    it('adds a relationship to sparse historical snapshots without replacing existing tables', async () => {
        const context = JoinRenameContext.create({ omitJoin: true });
        try {
            const mapped = contextMigrations(context).createModelSnapshot();
            const before = { ...mapped, entities: mapped.entities.map(entity => ({ ...entity, manyToManyRelationships: undefined })) };
            const after = await joinSnapshot();
            const initial = diffModelSnapshots({ formatVersion: 1, entities: [] }, before)
                .toMigration('20261004001203_CreateSparseJoin', 'CreateSparseJoin');
            const diff = diffModelSnapshots(before, after);
            expect(diff.operations.map(operation => operation.kind)).toEqual(['createJoinTable']);
            const added = diff.toMigration('20261004001204_AddJoin', 'AddJoin');
            const migrations = contextMigrations(context);
            await migrations.update([initial]);
            await joinRows(context, 'insert into join_entries values (\'book\', \'tenant\', \'Novel\')');
            await joinRows(context, 'insert into join_tags values (\'tag\', \'tenant\', \'Fiction\')');
            await migrations.update([initial, added]);
            await joinRows(context, 'insert into join_entry_tags values (\'book\', \'tag\')');
            await expectJoinCatalog(context, {});
            expect(sqliteGenerator.generateUpScript(added)).not.toContain('__entitykit_new_');
            await migrations.update([initial, added], { target: initial.id });
            expect(await joinRows(context, 'select name from sqlite_master where name = \'join_entry_tags\'' )).toEqual([]);
            expect(await joinRows(context, 'select label from join_entries')).toEqual([{ label: 'Novel' }]);
        } finally {
            await context.dispose();
        }
    });

    it('marks explicit association removal destructive and recreates its constraints on rollback', async () => {
        const context = JoinRenameContext.create();
        try {
            const before = contextMigrations(context).createModelSnapshot();
            const initial = diffModelSnapshots({ formatVersion: 1, entities: [] }, before)
                .toMigration('20261004001205_CreateRemovedJoin', 'CreateRemovedJoin');
            const diff = diffModelSnapshots(before, await joinSnapshot({ omitJoin: true }));
            expect(diff.operations.map(operation => operation.kind)).toEqual(['dropJoinTable']);
            expect(collectDestructiveWarnings(diff.operations)).toEqual(['Drop join table join_entry_tags']);
            const removed = diff.toMigration('20261004001206_RemoveJoin', 'RemoveJoin');
            const migrations = contextMigrations(context);
            await migrations.update([initial]);
            await seedJoinCatalog(context, false);
            await expectJoinCatalog(context, {});
            await migrations.update([initial, removed], { allowDataLoss: true });
            expect(await joinRows(context, 'select name from sqlite_master where name = \'join_entry_tags\'' )).toEqual([]);
            expect(await joinRows(context, 'select label from join_entries')).toEqual([{ label: 'Novel' }]);
            await migrations.update([initial, removed], { target: initial.id });
            await joinRows(context, 'insert into join_entry_tags values (\'book\', \'tag\')');
            await expectJoinCatalog(context, {});
        } finally {
            await context.dispose();
        }
    });

    it('keeps explicit join replacement separate from implicit rebuilding', async () => {
        const before = await joinSnapshot();
        const after = { ...before, entities: before.entities.map(entity => ({ ...entity,
            manyToManyRelationships: entity.manyToManyRelationships?.map(relationship => ({ ...relationship, deleteBehavior: 'cascade' })),
        })) };
        const diff = diffModelSnapshots(before, after);
        expect(diff.operations.map(operation => operation.kind)).toEqual(['dropJoinTable', 'createJoinTable']);
        const migration = diff.toMigration('20261004001207_ReplaceJoinBehavior', 'ReplaceJoinBehavior');
        for (const script of [sqliteGenerator.generateUpScript(migration), sqliteGenerator.generateDownScript(migration)]) {
            expect(script).toContain('drop table if exists "join_entry_tags"');
            expect(script).toContain('create table if not exists "join_entry_tags"');
            expect(script).not.toContain('__entitykit_new_join_entry_tags');
        }
        expect(sqliteGenerator.generateUpScript(migration)).toContain('on delete cascade');
        expect(sqliteGenerator.generateDownScript(migration)).toContain('on delete restrict');
    });

    it('keeps reciprocal declarations deterministic and creates one physical join table', async () => {
        const context = JoinRenameContext.create({ reciprocal: true });
        try {
            const snapshot = contextMigrations(context).createModelSnapshot();
            const diff = diffModelSnapshots({ formatVersion: 1, entities: [] }, snapshot);
            expect(diff.operations.filter(operation => operation.kind === 'createJoinTable')).toHaveLength(1);
            const initial = diff.toMigration('20261004001208_CreateReciprocalJoin', 'CreateReciprocalJoin');
            await contextMigrations(context).update([initial]);
            await seedJoinCatalog(context, false);
            await expectJoinCatalog(context, {});
            expect(await joinRows(context, 'select name from pragma_table_info(\'join_entry_tags\') order by cid'))
                .toEqual([{ name: 'entry_id' }, { name: 'tag_id' }]);
        } finally {
            await context.dispose();
        }
    });

    it.each([
        ['postgres', postgresProviderServices], ['mysql', mySqlProviderServices],
    ])('distinguishes %s join tables with the same name in different schemas', async (_name, provider) => {
        const snapshot = await joinSnapshot({ schema: 'library', secondJoinSchema: 'archive', secondJoinName: 'join_entry_tags' });
        const diff = diffModelSnapshots({ formatVersion: 1, entities: [] }, snapshot);
        expect(diff.operations.filter(operation => operation.kind === 'createJoinTable').map(operation => operation.schemaName))
            .toEqual(['library', 'archive']);
        const migration = diff.toMigration('20261004001209_CreateNamespacedJoins', 'CreateNamespacedJoins');
        const generator = new MigrationSqlGenerator(provider.migrationDialect, provider.createMigrationBuilder);
        const script = generator.generateUpScript(migration);
        expect(script).toContain(provider.dialect.quoteQualifiedIdentifier('library', 'join_entry_tags'));
        expect(script).toContain(provider.dialect.quoteQualifiedIdentifier('archive', 'join_entry_tags'));
    });

    it('rebuilds both retained join tables when one shared principal key changes', async () => {
        const context = JoinRenameContext.create({ secondJoinName: 'join_featured_tags' });
        try {
            const before = contextMigrations(context).createModelSnapshot();
            const after = await joinSnapshot({ secondJoinName: 'join_featured_tags', sourceRenamed: true });
            const initial = diffModelSnapshots({ formatVersion: 1, entities: [] }, before)
                .toMigration('20261004001210_CreateMultipleJoins', 'CreateMultipleJoins');
            const renamed = diffModelSnapshots(before, after, { renameHints: { columns: [{ tableName: 'join_entries', from: 'legacy_id', to: 'entry_key' }] } })
                .toMigration('20261004001211_RenameMultipleJoins', 'RenameMultipleJoins');
            const migrations = contextMigrations(context);
            await migrations.update([initial]);
            await seedJoinCatalog(context, false);
            await joinRows(context, 'insert into join_featured_tags values (\'book\', \'tag\')');
            await migrations.update([initial, renamed]);
            await expectJoinCatalog(context, { sourceRenamed: true });
            expect(await joinRows(context, 'select * from join_featured_tags')).toEqual([{ featured_entry: 'book', featured_tag: 'tag' }]);
            await migrations.update([initial, renamed], { target: initial.id });
            await expectJoinCatalog(context, {});
            expect(await joinRows(context, 'select * from join_featured_tags')).toEqual([{ featured_entry: 'book', featured_tag: 'tag' }]);
        } finally {
            await context.dispose();
        }
    });

    it('preserves a retained association while explicitly replacing a different join table', async () => {
        const context = JoinRenameContext.create({ secondJoinName: 'join_featured_tags' });
        try {
            const before = contextMigrations(context).createModelSnapshot();
            const mapped = await joinSnapshot({ secondJoinName: 'join_featured_tags', sourceRenamed: true });
            const after = { ...mapped, entities: mapped.entities.map(entity => ({ ...entity,
                manyToManyRelationships: entity.manyToManyRelationships?.map(relationship => relationship.joinTableName !== 'join_featured_tags'
                    ? relationship : { ...relationship, deleteBehavior: relationship.deleteBehavior === 'cascade' ? 'restrict' : 'cascade' }),
            })) };
            const initial = diffModelSnapshots({ formatVersion: 1, entities: [] }, before)
                .toMigration('20261004001213_CreateMixedJoins', 'CreateMixedJoins');
            const diff = diffModelSnapshots(before, after, { renameHints: { columns: [{ tableName: 'join_entries', from: 'legacy_id', to: 'entry_key' }] } });
            expect(diff.operations.filter(operation => operation.kind === 'dropJoinTable' || operation.kind === 'createJoinTable')
                .map(operation => [operation.kind, operation.tableName]))
                .toEqual([['dropJoinTable', 'join_featured_tags'], ['createJoinTable', 'join_featured_tags']]);
            const changed = diff.toMigration('20261004001214_RenameAndReplaceJoin', 'RenameAndReplaceJoin');
            for (const script of [sqliteGenerator.generateUpScript(changed), sqliteGenerator.generateDownScript(changed)]) {
                expect(script).toContain('__entitykit_new_join_entry_tags');
                expect(script).not.toContain('__entitykit_new_join_featured_tags');
                expect(script.split('drop table if exists "join_featured_tags"')).toHaveLength(2);
            }
            const migrations = contextMigrations(context);
            await migrations.update([initial]);
            await seedJoinCatalog(context, false);
            await joinRows(context, 'insert into join_featured_tags values (\'book\', \'tag\')');
            await migrations.update([initial, changed], { allowDataLoss: true });
            await expectJoinCatalog(context, { sourceRenamed: true });
            expect(await joinRows(context, 'select * from join_featured_tags')).toEqual([]);
            await joinRows(context, 'insert into join_featured_tags values (\'book\', \'tag\')');
            await migrations.update([initial, changed], { target: initial.id });
            await expectJoinCatalog(context, {});
            expect(await joinRows(context, 'select * from join_featured_tags')).toEqual([]);
            await joinRows(context, 'insert into join_featured_tags values (\'book\', \'tag\')');
            await expect(joinRows(context, 'insert into join_featured_tags values (\'missing\', \'tag\')')).rejects.toThrow();
        } finally {
            await context.dispose();
        }
    });

    it('restores original join references around a table-only rename and explicit key-name change', async () => {
        const context = JoinRenameContext.create();
        try {
            const before = contextMigrations(context).createModelSnapshot();
            const mapped = await joinSnapshot({ targetTable: 'edition_tags' });
            const after = { ...mapped, entities: mapped.entities.map(entity => ({ ...entity,
                manyToManyRelationships: entity.manyToManyRelationships?.map(relationship => ({ ...relationship, primaryKeyName: 'pk_replaced_join' })),
            })) };
            const diff = diffModelSnapshots(before, after, { renameHints: { tables: [{ from: 'join_tags', to: 'edition_tags' }] } });
            expect(diff.operations.map(operation => operation.kind)).toEqual(['dropJoinTable', 'renameTable', 'createJoinTable']);
            const drop = diff.operations[0];
            if (drop.kind !== 'dropJoinTable') throw new Error('Expected the original join to be dropped before its principal is renamed.');
            expect(drop.targetTableName).toBe('join_tags');
            const initial = diffModelSnapshots({ formatVersion: 1, entities: [] }, before)
                .toMigration('20261004001215_CreateTableRenameJoin', 'CreateTableRenameJoin');
            const changed = diff.toMigration('20261004001216_RenameAndReplaceJoinKey', 'RenameAndReplaceJoinKey');
            const migrations = contextMigrations(context);
            await migrations.update([initial]);
            await seedJoinCatalog(context, false);
            await migrations.update([initial, changed], { allowDataLoss: true });
            expect(await joinRows(context, 'select * from join_entry_tags')).toEqual([]);
            expect(await joinRows(context, 'select label from edition_tags')).toEqual([{ label: 'Fiction' }]);
            await joinRows(context, 'insert into join_entry_tags values (\'book\', \'tag\')');
            await migrations.update([initial, changed], { target: initial.id });
            expect(await joinRows(context, 'select * from join_entry_tags')).toEqual([]);
            await joinRows(context, 'insert into join_entry_tags values (\'book\', \'tag\')');
            await expectJoinCatalog(context, {});
        } finally {
            await context.dispose();
        }
    });

    it('retains foreign-key dependency phases when replacing a join without any rename', async () => {
        const base = await joinSnapshot();
        const before = { ...base, entities: base.entities.map(entity => entity.tableName !== 'join_entries' ? entity : { ...entity,
            relationships: [{ navigationProperty: 'primaryTag', principalEntityName: 'JoinTag', foreignKeyProperty: 'id',
                deleteBehavior: 'restrict', constraintName: 'fk_primary_tag' }],
        }) };
        const optional = await joinSnapshot({ optionalLabel: true });
        const after = { ...optional, entities: optional.entities.map(entity => ({ ...entity,
            manyToManyRelationships: entity.manyToManyRelationships?.map(relationship => ({ ...relationship, primaryKeyName: 'pk_replaced_join' })),
        })) };
        const diff = diffModelSnapshots(before, after);
        expect(diff.operations.map(operation => operation.kind)).toEqual(['dropForeignKey', 'dropJoinTable', 'alterColumn', 'createJoinTable']);
        const migration = diff.toMigration('20261004001217_RemoveDirectTagAndReplaceJoin', 'RemoveDirectTagAndReplaceJoin');
        for (const provider of [postgresProviderServices, mySqlProviderServices]) {
            const generator = new MigrationSqlGenerator(provider.migrationDialect, provider.createMigrationBuilder);
            const up = generator.generateUpScript(migration);
            expect(up.indexOf(provider.dialect.quoteIdentifier('fk_primary_tag')))
                .toBeLessThan(up.indexOf(`drop table if exists ${provider.dialect.quoteIdentifier('join_entry_tags')}`));
        }
    });

    it.each([
        ['sqlite', sqliteProviderServices], ['postgres', postgresProviderServices], ['mysql', mySqlProviderServices],
    ])('retains each %s rename and table drop once while placing SQLite rebuilds before retirement', async (name, provider) => {
        const before = await joinSnapshot({ retiredTable: true });
        const after = await joinSnapshot({ sourceRenamed: true });
        const migration = diffModelSnapshots(before, after, { renameHints: { columns: [{ tableName: 'join_entries', from: 'legacy_id', to: 'entry_key' }] } })
            .toMigration('20261004001212_RenameAndRetireJoin', 'RenameAndRetireJoin');
        const generator = new MigrationSqlGenerator(provider.migrationDialect, provider.createMigrationBuilder);
        const up = generator.generateUpScript(migration);
        const down = generator.generateDownScript(migration);
        const drop = `drop table if exists ${provider.dialect.quoteIdentifier('retired_join_rows')}`;
        expect(up.split(drop)).toHaveLength(2);
        expect(down.split(`create table if not exists ${provider.dialect.quoteIdentifier('retired_join_rows')}`)).toHaveLength(2);
        if (name === 'sqlite') {
            expect(up.indexOf('__entitykit_new_join_entry_tags')).toBeLessThan(up.indexOf(drop));
        } else {
            expect(up.split('rename column')).toHaveLength(2);
            expect(down.split('rename column')).toHaveLength(2);
        }
    });
});
