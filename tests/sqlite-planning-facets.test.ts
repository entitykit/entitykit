import type { ModelSnapshot } from '../packages/core/src/model/model-snapshot-types';
import { MigrationRunner, MigrationSqlGenerator, diffModelSnapshots } from '../packages/core/src/migrations/api';
import { SqliteDatabaseConnection, sqliteProviderServices } from '../packages/sqlite/src';
import { principalSnapshot } from './support/principal-column-rename-support';
import { planningRows, planningSnapshot, qualifyPlanningPair } from './support/sqlite-planning-support';

function scripts(before: ModelSnapshot, after: ModelSnapshot): readonly string[] {
    const migration = diffModelSnapshots(before, after).toMigration('20261004000101_ChangePlanningRecord', 'ChangePlanningRecord');
    const generator = new MigrationSqlGenerator(sqliteProviderServices.migrationDialect, sqliteProviderServices.createMigrationBuilder);
    return [generator.generateUpScript(migration), generator.generateDownScript(migration)];
}

describe('SQLite rebuild planning through public migration execution', () => {
    it.each(['plain', 'collated', 'computed'] as const)('adds a %s column and reverses it while preserving existing rows', async note => {
        const before = planningSnapshot();
        const after = planningSnapshot({ note });
        const [up] = scripts(before, after);
        expect(up.includes('__entitykit_new_')).toBe(note !== 'plain');

        await qualifyPlanningPair(before, after, async (connection, direction) => {
            expect(await planningRows(connection, 'select id, label from planning_records')).toEqual([{ id: 7, label: 'Novel' }]);
            if (direction === 'up') {
                expect(await planningRows(connection, 'select note from planning_records')).toEqual([{ note: note === 'computed' ? 'novel' : 'memo' }]);
                if (note === 'collated') expect(await planningRows(connection, 'select id from planning_records where note = \'MEMO\''))
                    .toEqual([{ id: 7 }]);
            } else await expect(planningRows(connection, 'select note from planning_records')).rejects.toThrow();
        });
    });

    it('recomputes an existing generated column instead of copying into it in either direction', async () => {
        await qualifyPlanningPair(planningSnapshot({ note: 'computed' }), planningSnapshot({ note: 'computed', optionalLabel: true }),
            async (connection, direction) => {
                expect(await planningRows(connection, 'select id, label, note from planning_records')).toEqual([
                    { id: 7, label: 'Novel', note: 'novel' },
                ]);
                if (direction === 'up') {
                    await planningRows(connection, 'update planning_records set label = null');
                    expect(await planningRows(connection, 'select note from planning_records')).toEqual([{ note: null }]);
                    await planningRows(connection, 'update planning_records set label = \'Novel\'');
                } else await expect(planningRows(connection, 'update planning_records set label = null')).rejects.toThrow();
            });
    });

    it('drops a plain column through a rebuild and restores its default on rollback', async () => {
        const before = planningSnapshot({ note: 'plain' });
        const after = planningSnapshot();
        expect(scripts(before, after)[0]).toContain('__entitykit_new_planning_records');
        await qualifyPlanningPair(before, after, async (connection, direction) => {
            expect(await planningRows(connection, 'select id, label from planning_records')).toEqual([{ id: 7, label: 'Novel' }]);
            if (direction === 'down') expect(await planningRows(connection, 'select note from planning_records')).toEqual([{ note: 'memo' }]);
            else await expect(planningRows(connection, 'select note from planning_records')).rejects.toThrow();
        });
    });

    it.each([false, true])('adds and removes a check independently of column changes (initially present: %s)', async present => {
        await qualifyPlanningPair(planningSnapshot({ check: present }), planningSnapshot({ check: !present }),
            async (connection, direction) => {
                const constrained = direction === 'up' ? !present : present;
                expect(await planningRows(connection, 'select id, label from planning_records')).toEqual([{ id: 7, label: 'Novel' }]);
                if (constrained) await expect(planningRows(connection, 'update planning_records set label = \'\''))
                    .rejects.toThrow('ck_planning_label');
                else {
                    await planningRows(connection, 'update planning_records set label = \'\'');
                    await planningRows(connection, 'update planning_records set label = \'Novel\'');
                }
            });
    });

    it.each([false, true])('absorbs index changes into an accompanying rebuild (initially present: %s)', async present => {
        const before = planningSnapshot({ index: present });
        const after = planningSnapshot({ index: !present, optionalLabel: true });
        scripts(before, after).forEach((script, index) => {
            const indexed = index === 0 ? !present : present;
            expect(script).not.toContain('drop index');
            expect(script.match(/create index if not exists "ix_planning_label"/gu) ?? []).toHaveLength(indexed ? 1 : 0);
        });
        await qualifyPlanningPair(before, after,
            async (connection, direction) => {
                const indexed = direction === 'up' ? !present : present;
                expect(await planningRows(connection, 'select id, label from planning_records')).toEqual([{ id: 7, label: 'Novel' }]);
                expect(await planningRows(connection, 'select name from sqlite_master where name = \'ix_planning_label\''))
                    .toEqual(indexed ? [{ name: 'ix_planning_label' }] : []);
            });
    });

    it.each([false, true])('adds a primary key to a populated keyless table (generated: %s)', async generated => {
        await qualifyPlanningPair(planningSnapshot({ keyed: false }), planningSnapshot({ generated }), async (connection, direction) => {
            expect(await planningRows(connection, 'select label from planning_records')).toEqual([{ label: 'Novel' }]);
            if (direction === 'up') {
                expect(await planningRows(connection, 'select id from planning_records')).toEqual([{ id: 1 }]);
                await expect(planningRows(connection, 'insert into planning_records (id, label) values (1, \'duplicate\')')).rejects.toThrow();
            } else await expect(planningRows(connection, 'select id from planning_records')).rejects.toThrow();
        });
    });

    it.each([false, true])('adds and removes a populated foreign key with no column changes (initially present: %s)', async present => {
        const withForeignKey = principalSnapshot('primary', false);
        const withoutForeignKey = {
            ...withForeignKey,
            entities: withForeignKey.entities.map(entity => ({ ...entity, relationships: [] })),
        };
        const before = present ? withForeignKey : withoutForeignKey;
        const after = present ? withoutForeignKey : withForeignKey;
        const initial = diffModelSnapshots({ formatVersion: 1, entities: [] }, before).toMigration('20261004000100_CreatePlanningRecord', 'CreatePlanningRecord');
        const changed = diffModelSnapshots(before, after).toMigration('20261004000101_ChangePlanningRecord', 'ChangePlanningRecord');
        const connection = new SqliteDatabaseConnection(':memory:');
        const runner = new MigrationRunner(connection, sqliteProviderServices.migrationDialect, sqliteProviderServices.createMigrationBuilder);
        try {
            await runner.update([initial]);
            await planningRows(connection, 'insert into catalog_entries values (\'edition\', \'tenant\', \'Novel\')');
            await planningRows(connection, 'insert into catalog_links values (\'link\', \'edition\', \'tenant\')');
            for (const direction of ['up', 'down'] as const) {
                await runner.update([initial, changed], direction === 'up' ? { allowDataLoss: present } : { target: initial.id });
                expect(await planningRows(connection, 'select * from catalog_links')).toEqual([
                    { id: 'link', owner_key: 'edition', owner_tenant: 'tenant' },
                ]);
                const constrained = direction === 'up' ? !present : present;
                if (constrained) await expect(planningRows(connection, 'insert into catalog_links values (\'invalid\', \'missing\', \'tenant\')')).rejects.toThrow();
                else {
                    await planningRows(connection, 'insert into catalog_links values (\'invalid\', \'missing\', \'tenant\')');
                    await planningRows(connection, 'delete from catalog_links where id = \'invalid\'');
                }
            }
        } finally {
            await connection.dispose();
        }
    });
});
