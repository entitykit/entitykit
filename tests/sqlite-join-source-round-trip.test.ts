import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as migrationsApi from '../packages/core/src/migrations/api';
import { contextMigrations, renderSnapshotSource, scaffoldMigration, type Migration, type ModelSnapshot, type ModelDiffRenameHints } from '../packages/core/src/migrations/api';
import { createManagedTempDirectory } from './support/managed-temp-directory';
import { expectJoinCatalog, joinSnapshot, JoinRenameContext, seedJoinCatalog } from './support/join-principal-rename-support';

/** Execute actual generated TypeScript against the public migration module. */
function compiledMigration(source: string): Migration {
    const module: { exports: { default?: new () => Migration } } = { exports: {} };
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    vm.runInNewContext(compiled.outputText, {
        module, exports: module.exports,
        require: (name: string): typeof migrationsApi => {
            if (name !== '@entitykit/core/migrations') throw new Error(`Unexpected generated import ${name}.`);
            return migrationsApi;
        },
    }, { timeout: 1000 });
    const Constructor = module.exports.default;
    if (Constructor === undefined) throw new Error('Generated migration has no default export.');
    return new Constructor();
}

function scaffoldPair(before: ModelSnapshot, after: ModelSnapshot, renameHints: ModelDiffRenameHints): {
    initial: Migration; renamed: Migration; source: string;
} {
    const directory = createManagedTempDirectory('entitykit-join-source-');
    const snapshotPath = path.join(directory, 'EntityKitModelSnapshot.ts');
    const initial = scaffoldMigration({ createModelSnapshot: () => before }, {
        name: 'CreateSourceJoin', migrationsDir: directory, snapshotPath, now: new Date('2026-10-04T00:15:00Z'),
    });
    fs.writeFileSync(snapshotPath, renderSnapshotSource(before));
    const renamed = scaffoldMigration({ createModelSnapshot: () => after }, {
        name: 'RenameSourceJoin', migrationsDir: directory, snapshotPath, renameHints, now: new Date('2026-10-04T00:15:01Z'),
    });
    return { initial: compiledMigration(initial.migrationSource), renamed: compiledMigration(renamed.migrationSource), source: renamed.migrationSource };
}

describe('scaffolded join migrations through actual generated source', () => {
    it.each([false, true].flatMap(composite => ['source', 'target', 'both'].map(side => ({ composite, side }))))(
        'preserves $side key renames and associations through compiled source, composite=$composite', async ({ composite, side }) => {
            const context = JoinRenameContext.create({ composite });
            try {
                const before = contextMigrations(context).createModelSnapshot();
                const settings = { composite, sourceRenamed: side !== 'target', targetRenamed: side !== 'source' };
                const after = await joinSnapshot(settings);
                const columns = [
                    ...settings.sourceRenamed ? [{ tableName: 'join_entries', from: 'legacy_id', to: 'entry_key' }] : [],
                    ...settings.targetRenamed ? [{ tableName: 'join_tags', from: 'legacy_id', to: 'tag_key' }] : [],
                ];
                const { initial, renamed, source } = scaffoldPair(before, after, { columns });
                expect(source).toContain('if (builder.requiresTableRebuild)');
                expect(source).toContain('"tableName": "join_entry_tags"');
                const migrations = contextMigrations(context);
                await migrations.update([initial]);
                await seedJoinCatalog(context, composite);
                await migrations.update([initial, renamed], { allowDataLoss: true });
                await expectJoinCatalog(context, settings);
                await migrations.update([initial, renamed], { target: initial.id });
                await expectJoinCatalog(context, { composite });
            } finally {
                await context.dispose();
            }
        },
    );

    it('keeps original target entity aliases while its table and the source key are renamed', async () => {
        const context = JoinRenameContext.create();
        try {
            const before = contextMigrations(context).createModelSnapshot();
            const mapped = await joinSnapshot({ sourceRenamed: true, targetTable: 'edition_tags' });
            const after = { ...mapped, entities: mapped.entities.map(entity => ({ ...entity,
                entityName: entity.entityName === 'JoinTag' ? 'EditionTag' : entity.entityName,
                manyToManyRelationships: entity.manyToManyRelationships?.map(relationship => ({ ...relationship,
                    targetEntityName: relationship.targetEntityName === 'JoinTag' ? 'EditionTag' : relationship.targetEntityName,
                })),
            })) };
            const { initial, renamed } = scaffoldPair(before, after, {
                tables: [{ from: 'join_tags', to: 'edition_tags' }],
                columns: [{ tableName: 'join_entries', from: 'legacy_id', to: 'entry_key' }],
            });
            const migrations = contextMigrations(context);
            await migrations.update([initial]);
            await seedJoinCatalog(context, false);
            await migrations.update([initial, renamed], { allowDataLoss: true });
            await expectJoinCatalog(context, { sourceRenamed: true, targetTable: 'edition_tags' });
            await migrations.update([initial, renamed], { target: initial.id });
            await expectJoinCatalog(context, {});
        } finally {
            await context.dispose();
        }
    });

    it('retains portable join rebuilding before sequence retirement in generated source', async () => {
        const base = await joinSnapshot();
        const before = { ...base, sequences: [{ name: 'retired_join_numbers', isCyclic: false }] };
        const after = await joinSnapshot({ sourceRenamed: true });
        const { source } = scaffoldPair(before, after, { columns: [{ tableName: 'join_entries', from: 'legacy_id', to: 'entry_key' }] });
        const up = source.split('override up(')[1].split('override down(')[0];
        const down = source.split('override down(')[1];
        expect(up).toContain('builder.dropSequence(');
        expect(up.lastIndexOf('"tableName": "join_entry_tags"')).toBeLessThan(up.indexOf('builder.dropSequence('));
        expect(down).toContain('builder.createSequence(');
        expect(down.indexOf('builder.createSequence(')).toBeLessThan(down.indexOf('"tableName": "join_entry_tags"'));
    });

    it('restores an explicitly replaced join after a table-only rename through compiled source', async () => {
        const context = JoinRenameContext.create();
        try {
            const before = contextMigrations(context).createModelSnapshot();
            const mapped = await joinSnapshot({ targetTable: 'edition_tags' });
            const after = { ...mapped, entities: mapped.entities.map(entity => ({ ...entity,
                manyToManyRelationships: entity.manyToManyRelationships?.map(relationship => ({ ...relationship, primaryKeyName: 'pk_replaced_join' })),
            })) };
            const { initial, renamed } = scaffoldPair(before, after, { tables: [{ from: 'join_tags', to: 'edition_tags' }] });
            const migrations = contextMigrations(context);
            await migrations.update([initial]);
            await seedJoinCatalog(context, false);
            await migrations.update([initial, renamed], { allowDataLoss: true });
            expect((await context.database.connection.query({ text: 'select * from join_entry_tags', values: [] })).rows).toEqual([]);
            await context.database.connection.query({ text: 'insert into join_entry_tags values (\'book\', \'tag\')', values: [] });
            await migrations.update([initial, renamed], { target: initial.id });
            expect((await context.database.connection.query({ text: 'select * from join_entry_tags', values: [] })).rows).toEqual([]);
            await context.database.connection.query({ text: 'insert into join_entry_tags values (\'book\', \'tag\')', values: [] });
            await expectJoinCatalog(context, {});
        } finally {
            await context.dispose();
        }
    });
});
