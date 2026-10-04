import fs from 'node:fs';
import path from 'node:path';
import {
    MigrationError, MigrationRunner, contextMigrations, diffModelSnapshots, renderSnapshotSource, scaffoldMigration,
    type ModelSnapshot,
} from '../packages/core/src/migrations/api';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { createManagedTempDirectory } from './support/managed-temp-directory';
import { expectJoinCatalog, joinRows, joinSnapshot, JoinRenameContext, seedJoinCatalog } from './support/join-principal-rename-support';

function reordered(snapshot: ModelSnapshot, side: string): ModelSnapshot {
    return { ...snapshot, entities: snapshot.entities.map(entity => ({ ...entity,
        keyProperties: side === 'both' || entity.tableName === (side === 'source' ? 'join_entries' : 'join_tags')
            ? [...entity.keyProperties ?? []].reverse() : entity.keyProperties,
    })) };
}

describe('existing composite primary-key order changes', () => {
    it.each([undefined, 'main', 'MAIN'].flatMap(schema => ['source', 'target', 'both'].map(side => ({ schema, side }))))(
        'refuses $side reordering before scaffold or SQL, schema=$schema', async ({ schema, side }) => {
            const context = JoinRenameContext.create({ schema, composite: true });
            try {
                const migrations = contextMigrations(context);
                const before = migrations.createModelSnapshot();
                const after = reordered(before, side);
                const initial = diffModelSnapshots({ formatVersion: 1, entities: [] }, before)
                    .toMigration('20261004002100_CreateOrderRefusalJoin', 'CreateOrderRefusalJoin');
                await migrations.update([initial]);
                await seedJoinCatalog(context, true);
                const query = jest.spyOn(context.database.connection, 'query');
                let failure: unknown;
                try {
                    diffModelSnapshots(before, after);
                } catch (error) {
                    failure = error;
                }
                expect(failure).toBeInstanceOf(MigrationError);
                const tableName = side === 'target' ? 'join_tags' : 'join_entries';
                expect(failure).toMatchObject({ code: 'MIGRATION_ERROR', details: {
                    tableName, schemaName: schema, previousColumns: ['tenant', 'legacy_id'], targetColumns: ['legacy_id', 'tenant'],
                } });
                expect((failure as Error).message).toBe(`Primary-key reordering on existing table '${tableName}' requires reviewed provider SQL.`);
                expect(query).not.toHaveBeenCalled();
                query.mockRestore();
                const directory = createManagedTempDirectory('entitykit-key-order-refusal-');
                const snapshotPath = path.join(directory, 'EntityKitModelSnapshot.ts');
                const source = renderSnapshotSource(before);
                fs.writeFileSync(snapshotPath, source);
                for (const allowEmpty of [false, true]) {
                    expect(() => scaffoldMigration({ createModelSnapshot: () => after }, {
                        name: 'ReorderPrimaryKey', migrationsDir: directory, snapshotPath, allowEmpty,
                    })).toThrow(MigrationError);
                    expect(fs.readdirSync(directory)).toEqual(['EntityKitModelSnapshot.ts']);
                    expect(fs.readFileSync(snapshotPath, 'utf8')).toBe(source);
                }
                await expectJoinCatalog(context, { schema, composite: true });
                const runner = new MigrationRunner(context.database.connection, sqliteProviderServices.migrationDialect, sqliteProviderServices.createMigrationBuilder);
                expect((await runner.getAppliedMigrations({ initializeHistory: false })).map(row => row.id)).toEqual([initial.id]);
            } finally {
                await context.dispose();
            }
        },
    );

    it('accepts property refactors and declaration reordering that preserve the physical key tuple', async () => {
        const before = await joinSnapshot({ composite: true, omitJoin: true });
        const refactored = { ...before, entities: before.entities.map(entity => ({ ...entity,
            keyProperties: ['tenant', 'code'],
            properties: entity.properties.map(property => property.propertyName === 'id' ? { ...property, propertyName: 'code' } : property).reverse(),
        })) };
        expect(diffModelSnapshots(before, refactored).hasChanges).toBe(false);
    });

    it.each(['source', 'target', 'both'])('accepts explicit %s physical key renames without confusing them with tuple reordering', async side => {
        const before = await joinSnapshot({ composite: true });
        const settings = { composite: true, sourceRenamed: side !== 'target', targetRenamed: side !== 'source' };
        const after = await joinSnapshot(settings);
        const columns = [
            ...settings.sourceRenamed ? [{ tableName: 'join_entries', from: 'legacy_id', to: 'entry_key' }] : [],
            ...settings.targetRenamed ? [{ tableName: 'join_tags', from: 'legacy_id', to: 'tag_key' }] : [],
        ];
        expect(diffModelSnapshots(before, after, { renameHints: { columns } }).hasChanges).toBe(true);
    });

    it.each(['selectors', 'flags'])('accepts a compatible legacy composite snapshot using %s metadata', async kind => {
        const before = await joinSnapshot({ composite: true, omitJoin: true });
        const legacy = { ...before, entities: before.entities.map(entity => ({ ...entity,
            keyProperties: kind === 'flags' ? undefined : ['id', 'tenant'], keyProperty: undefined,
        })) };
        const current = { ...before, entities: before.entities.map(entity => ({ ...entity, keyProperties: ['id', 'tenant'] })) };
        expect(diffModelSnapshots(legacy, current).hasChanges).toBe(false);
    });

    it('refuses a three-column reorder even when one position is unchanged', async () => {
        const snapshot = await joinSnapshot({ composite: true, omitJoin: true });
        const before = { ...snapshot, entities: snapshot.entities.map(entity => ({ ...entity,
            keyProperties: ['tenant', 'id', 'label'], properties: entity.properties.map(property => ({ ...property, isPrimaryKey: true })),
        })) };
        const after = { ...before, entities: before.entities.map(entity => ({ ...entity, keyProperties: ['tenant', 'label', 'id'] })) };
        expect(() => diffModelSnapshots(before, after)).toThrow(MigrationError);
    });

    it('refuses reordering from legacy composite primary flags', async () => {
        const after = await joinSnapshot({ composite: true, omitJoin: true });
        const before = { ...after, entities: after.entities.map(entity => ({ ...entity, keyProperty: undefined, keyProperties: undefined })) };
        expect(() => diffModelSnapshots(before, after)).toThrow(MigrationError);
    });

    it('accepts legacy single-key selectors without inventing a composite-order change', async () => {
        const snapshot = await joinSnapshot({ omitJoin: true });
        const legacy = { ...snapshot, entities: snapshot.entities.map(entity => ({ ...entity, keyProperties: undefined })) };
        expect(diffModelSnapshots(legacy, snapshot).hasChanges).toBe(false);
    });

    it.each(['grow', 'grow reordered', 'shrink', 'replace'])('retains a populated SQLite key %s change with its rebuild and rollback', async kind => {
        const context = JoinRenameContext.create({ composite: true, omitJoin: true });
        try {
            const migrations = contextMigrations(context);
            const before = migrations.createModelSnapshot();
            const keyProperties = kind === 'grow' ? ['tenant', 'id', 'label'] : kind === 'grow reordered'
                ? ['id', 'tenant', 'label'] : kind === 'shrink' ? ['id'] : ['tenant', 'label'];
            const after = { ...before, entities: before.entities.map(entity => ({ ...entity,
                keyProperty: kind === 'shrink' ? 'id' : undefined, keyProperties,
                properties: entity.properties.map(property => ({ ...property, isPrimaryKey: keyProperties.includes(property.propertyName) })),
            })) };
            const initial = diffModelSnapshots({ formatVersion: 1, entities: [] }, before)
                .toMigration('20261004002103_CreateExistingOrderKeys', 'CreateExistingOrderKeys');
            const changed = diffModelSnapshots(before, after).toMigration('20261004002104_ChangeKeyMembership', 'ChangeKeyMembership');
            await migrations.update([initial]);
            await joinRows(context, 'insert into join_entries values (\'book\', \'tenant\', \'Novel\')');
            for (const direction of ['up', 'down'] as const) {
                await migrations.update([initial, changed], direction === 'up' ? {} : { target: initial.id });
                expect(await joinRows(context, 'select * from join_entries')).toEqual([{ legacy_id: 'book', tenant: 'tenant', label: 'Novel' }]);
                const properties = direction === 'up' ? keyProperties : ['tenant', 'id'];
                expect(await joinRows(context, 'select name from pragma_table_info(\'join_entries\') where pk > 0 order by pk'))
                    .toEqual(properties.map(property => ({ name: property === 'id' ? 'legacy_id' : property })));
            }
        } finally {
            await context.dispose();
        }
    });

    it('retains actual key additions on a populated keyless table', async () => {
        const context = JoinRenameContext.create({ omitJoin: true });
        try {
            const migrations = contextMigrations(context);
            const after = migrations.createModelSnapshot();
            const before = { ...after, entities: after.entities.map(entity => ({ ...entity,
                keyProperty: undefined, keyProperties: [], properties: entity.properties.map(property => ({ ...property, isPrimaryKey: false })),
            })) };
            const initial = diffModelSnapshots({ formatVersion: 1, entities: [] }, before)
                .toMigration('20261004002101_CreateKeylessOrderRows', 'CreateKeylessOrderRows');
            const added = diffModelSnapshots(before, after).toMigration('20261004002102_AddOrderKey', 'AddOrderKey');
            await migrations.update([initial]);
            await joinRows(context, 'insert into join_entries values (\'book\', \'tenant\', \'Novel\')');
            await migrations.update([initial, added]);
            expect(await joinRows(context, 'select * from join_entries')).toEqual([{ legacy_id: 'book', tenant: 'tenant', label: 'Novel' }]);
            expect(await joinRows(context, 'select name from pragma_table_info(\'join_entries\') where pk = 1')).toEqual([{ name: 'legacy_id' }]);
        } finally {
            await context.dispose();
        }
    });
});
