import fs from 'node:fs';
import path from 'node:path';
import {
    MigrationDataLossError, MigrationError, MigrationRunner, collectDestructiveWarnings, contextMigrations,
    diffModelSnapshots, renderSnapshotSource, scaffoldMigration,
    type Migration, type MigrationUpdateOptions, type MigrationUpdateResult, type ModelSnapshot,
} from '../packages/core/src/migrations/api';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { compiledMigration } from './support/compiled-migration-source';
import { createManagedTempDirectory } from './support/managed-temp-directory';
import { expectJoinCatalog, joinRows, joinSnapshot, JoinRenameContext, seedJoinCatalog } from './support/join-principal-rename-support';

function withoutFacet(before: ModelSnapshot, kind: string): ModelSnapshot {
    return kind === 'tables' ? { formatVersion: 1, entities: [] } : { ...before, entities: before.entities.map(entity => ({ ...entity,
        manyToManyRelationships: kind === 'join' ? [] : entity.manyToManyRelationships,
        properties: kind === 'column' && entity.tableName === 'join_entries'
            ? entity.properties.filter(property => property.propertyName !== 'label') : entity.properties,
    })) };
}

const refusals = [undefined, 'main'].flatMap(schema => ['context', 'runner'].flatMap(route =>
    ['join', 'column', 'tables'].map(kind => ({ schema, route, kind }))));

describe('reviewed migration warnings through actual execution', () => {
    it.each(refusals)('refuses generated $kind removal before DDL through $route, schema=$schema', async ({ schema, route, kind }) => {
        const context = JoinRenameContext.create({ schema });
        try {
            const migrations = contextMigrations(context);
            const runner = new MigrationRunner(context.database.connection, sqliteProviderServices.migrationDialect, sqliteProviderServices.createMigrationBuilder);
            const update = async (items: readonly Migration[], options: MigrationUpdateOptions = {}): Promise<MigrationUpdateResult> =>
                route === 'context' ? migrations.update(items, options) : runner.update(items, options);
            const before = migrations.createModelSnapshot();
            const initial = diffModelSnapshots({ formatVersion: 1, entities: [] }, before)
                .toMigration('20261004001700_CreateWarningJoin', 'CreateWarningJoin');
            const diff = diffModelSnapshots(before, withoutFacet(before, kind));
            const removal = diff.toMigration('20261004001701_RemoveWarningFacet', 'RemoveWarningFacet');
            const warnings = collectDestructiveWarnings(diff.operations);
            expect(warnings.length).toBeGreaterThan(0);
            expect(removal.destructiveWarnings).toEqual(warnings);
            expect(Object.isFrozen(removal.destructiveWarnings)).toBe(true);
            await update([initial]);
            await seedJoinCatalog(context, false);
            const query = jest.spyOn(context.database.connection, 'query');
            await expect(update([initial, removal])).rejects.toMatchObject({ name: 'MigrationDataLossError', warnings });
            expect(query.mock.calls.some(([statement]) => /^\s*(?:drop|alter|delete)\b/iu.test(statement.text))).toBe(false);
            query.mockRestore();
            await expectJoinCatalog(context, { schema });
            expect((await runner.getAppliedMigrations({ initializeHistory: false })).map(row => row.id)).toEqual([initial.id]);
            await update([initial, removal], { allowDataLoss: true });
            expect((await runner.getAppliedMigrations({ initializeHistory: false })).map(row => row.id)).toEqual([initial.id, removal.id]);
            if (kind === 'column') expect(await joinRows(context, 'select name from pragma_table_info(\'join_entries\') where name = \'label\'' )).toEqual([]);
            else expect(await joinRows(context, `select name from sqlite_master where name = '${kind === 'join' ? 'join_entry_tags' : 'join_entries'}'`)).toEqual([]);
        } finally {
            await context.dispose();
        }
    });

    it.each(['source', 'target', 'both'])('keeps an explicit %s principal rename safe without data-loss approval', async side => {
        const context = JoinRenameContext.create();
        try {
            const migrations = contextMigrations(context);
            const before = migrations.createModelSnapshot();
            const settings = { sourceRenamed: side !== 'target', targetRenamed: side !== 'source' };
            const after = await joinSnapshot(settings);
            const columns = [
                ...settings.sourceRenamed ? [{ tableName: 'join_entries', from: 'legacy_id', to: 'entry_key' }] : [],
                ...settings.targetRenamed ? [{ tableName: 'join_tags', from: 'legacy_id', to: 'tag_key' }] : [],
            ];
            const initial = diffModelSnapshots({ formatVersion: 1, entities: [] }, before)
                .toMigration('20261004001702_CreateSafeWarningJoin', 'CreateSafeWarningJoin');
            const diff = diffModelSnapshots(before, after, { renameHints: { columns } });
            expect(collectDestructiveWarnings(diff.operations)).toEqual([]);
            const renamed = diff.toMigration('20261004001703_RenameSafeWarningJoin', 'RenameSafeWarningJoin');
            await migrations.update([initial]);
            await seedJoinCatalog(context, false);
            await migrations.update([initial, renamed]);
            await expectJoinCatalog(context, settings);
            expect((await migrations.update([initial, renamed])).appliedMigrations).toEqual([]);
            await migrations.update([initial, renamed], { target: initial.id });
            await expectJoinCatalog(context, {});
        } finally {
            await context.dispose();
        }
    });

    it.each(['column', 'table'])('retains safe %s rename intent through compiled scaffold metadata', async kind => {
        const context = JoinRenameContext.create();
        try {
            const migrations = contextMigrations(context);
            const before = migrations.createModelSnapshot();
            const settings = kind === 'column' ? { sourceRenamed: true } : { targetTable: 'edition_tags' };
            const after = await joinSnapshot(settings);
            const directory = createManagedTempDirectory('entitykit-warning-source-');
            const snapshotPath = path.join(directory, 'EntityKitModelSnapshot.ts');
            const initial = diffModelSnapshots({ formatVersion: 1, entities: [] }, before)
                .toMigration('20261004001704_CreateCompiledWarningJoin', 'CreateCompiledWarningJoin');
            fs.writeFileSync(snapshotPath, renderSnapshotSource(before));
            const result = scaffoldMigration({ createModelSnapshot: () => after }, {
                name: 'RenameCompiledWarningJoin', migrationsDir: directory, snapshotPath, now: new Date('2026-10-04T00:17:05Z'),
                renameHints: kind === 'column'
                    ? { columns: [{ tableName: 'join_entries', from: 'legacy_id', to: 'entry_key' }] }
                    : { tables: [{ from: 'join_tags', to: 'edition_tags' }] },
            });
            expect(result.warnings).toEqual([]);
            const renamed = compiledMigration(result.migrationSource);
            expect(renamed.destructiveWarnings).toEqual([]);
            expect(Object.isFrozen(renamed.destructiveWarnings)).toBe(true);
            await migrations.update([initial]);
            await seedJoinCatalog(context, false);
            await migrations.update([initial, renamed]);
            await expectJoinCatalog(context, settings);
            await migrations.update([initial, renamed], { target: initial.id });
            await expectJoinCatalog(context, {});
        } finally {
            await context.dispose();
        }
    });

    it('keeps legacy snapshot-only migrations protected without requiring new metadata', async () => {
        const context = JoinRenameContext.create();
        try {
            const migrations = contextMigrations(context);
            const before = migrations.createModelSnapshot();
            const initial = diffModelSnapshots({ formatVersion: 1, entities: [] }, before)
                .toMigration('20261004001706_CreateLegacyWarningJoin', 'CreateLegacyWarningJoin');
            const legacy: Migration = {
                id: '20261004001707_RemoveLegacyWarningJoin', name: 'RemoveLegacyWarningJoin',
                previousSnapshot: before, targetSnapshot: withoutFacet(before, 'join'),
                up: builder => builder.dropTable('join_entry_tags'), down: () => undefined,
            };
            await migrations.update([initial]);
            await seedJoinCatalog(context, false);
            await expect(migrations.update([initial, legacy])).rejects.toBeInstanceOf(MigrationDataLossError);
            await expectJoinCatalog(context, {});
        } finally {
            await context.dispose();
        }
    });

    it.each([null, false, '', {}, [null], [''], [' '], [1], [undefined], ['Review removal', null], [null, 'Review removal']].map(warnings => ({ warnings })))(
        'refuses malformed reviewed warnings $warnings before applying any user SQL', async ({ warnings }) => {
            const context = JoinRenameContext.create();
            try {
                const migration: Migration = { id: '20261004001708_InvalidWarnings', name: 'InvalidWarnings', up: builder => builder.sql('select 1'), down: () => undefined };
                Object.defineProperty(migration, 'destructiveWarnings', { value: warnings });
                const failure = contextMigrations(context).update([migration], { allowDataLoss: true });
                await expect(failure).rejects.toBeInstanceOf(MigrationError);
                await expect(failure).rejects.toThrow('destructiveWarnings');
                expect(await joinRows(context, 'select id from __entitykit_migrations')).toEqual([]);
            } finally {
                await context.dispose();
            }
        },
    );

    it.each(['none', 'previous', 'target'])('preserves a legacy migration carrying %s snapshot metadata', async kind => {
        const context = JoinRenameContext.create();
        try {
            const snapshot = contextMigrations(context).createModelSnapshot();
            const legacy: Migration = {
                id: '20261004001709_PartialLegacyWarnings', name: 'PartialLegacyWarnings',
                previousSnapshot: kind === 'previous' ? snapshot : undefined,
                targetSnapshot: kind === 'target' ? snapshot : undefined,
                up: builder => builder.sql('select 1'), down: () => undefined,
            };
            expect((await contextMigrations(context).update([legacy])).appliedMigrations).toEqual([`up:${legacy.id}`]);
        } finally {
            await context.dispose();
        }
    });
});
