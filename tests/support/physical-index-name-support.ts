import { contextMigrations, diffModelSnapshots } from '../../packages/core/src/migrations/api';
import { createSqliteDataSource } from '../../packages/sqlite/src';
import { createPostgresDataSource } from '../../packages/postgres/src';
import { createMySqlDataSource } from '../../packages/mysql/src';
import { RelationshipIndexContext, type RelationshipIndexMode } from './one-to-one-index-support';

const collision = 'Entity \'IndexProfile\' maps multiple indexes to database name \'ux_ek_index_profiles_user_id\'. Configure distinct index database names.';
export function definePhysicalIndexNameTests(provider: 'sqlite' | 'postgres' | 'mysql', url: () => string): void {
    const invalid: RelationshipIndexMode[] = ['filteredUnnamed', 'propertyFirstCollision', 'expressionFirstCollision'];
    it.each(invalid)('rejects %s before creating a fresh schema', async mode => {
        await qualify(provider, url(), mode, 'fresh');
    });
    it.each(invalid)('rejects %s before planning an upgrade and preserves populated uniqueness', async mode => {
        await qualify(provider, url(), mode, 'refusedUpgrade');
    });
    const valid: RelationshipIndexMode[] = ['propertyFirst', 'expressionFirst'];
    if (provider !== 'mysql') valid.push('filtered');
    it.each(valid)('retains uniqueness through adding, removing and rolling back %s', async mode => {
        await qualify(provider, url(), mode, 'migrations');
    });
}

async function qualify(provider: 'sqlite' | 'postgres' | 'mysql', url: string, mode: RelationshipIndexMode,
    operation: 'fresh' | 'refusedUpgrade' | 'migrations'): Promise<void> {
    const source = provider === 'sqlite' ? createSqliteDataSource(url)
        : provider === 'postgres' ? createPostgresDataSource(url) : createMySqlDataSource(url);
    try {
        await using original = source.createContext(RelationshipIndexContext, 'original');
        const query = async (text: string): ReturnType<typeof original.database.connection.query> => original.database.connection.query({ text, values: [] });
        const cleanup = async (): Promise<void> => {
            await query('drop table if exists ek_index_profiles');
            await query('drop table if exists ek_index_users');
            await query('drop table if exists __entitykit_migrations');
        };
        await cleanup();
        try {
            if (operation === 'fresh') {
                expect(() => source.createContext(RelationshipIndexContext, mode)).toThrow(collision);
                const sql = provider === 'sqlite' ? 'select name from sqlite_master where type = \'table\' and name in (\'ek_index_users\', \'ek_index_profiles\')'
                    : provider === 'postgres' ? 'select tablename as name from pg_tables where schemaname = current_schema() and tablename in (\'ek_index_users\', \'ek_index_profiles\')'
                        : 'select table_name as name from information_schema.tables where table_schema = database() and table_name in (\'ek_index_users\', \'ek_index_profiles\')';
                expect((await query(sql)).rows).toEqual([]);
                return;
            }
            const before = contextMigrations(original).createModelSnapshot();
            const initial = diffModelSnapshots({ formatVersion: 1, entities: [] }, before).toMigration('20261004010000_Initial', 'Initial');
            await contextMigrations(original).update([initial]);
            await query('insert into ek_index_users (id) values (\'user-1\'), (\'user-2\')');
            await query('insert into ek_index_profiles (id, user_id, label) values (\'first\', \'user-1\', \'hidden\')');
            const assertEnforced = async (): Promise<void> => {
                await expect(query('insert into ek_index_profiles (id, user_id, label) values (\'duplicate\', \'user-1\', \'hidden\')')).rejects.toThrow();
                expect((await query('select id from ek_index_profiles order by id')).rows).toEqual([{ id: 'first' }]);
            };
            if (operation === 'refusedUpgrade') {
                expect(() => source.createContext(RelationshipIndexContext, mode)).toThrow(collision);
                await assertEnforced();
                return;
            }
            await using target = source.createContext(RelationshipIndexContext, mode);
            const after = contextMigrations(target).createModelSnapshot();
            const adding = diffModelSnapshots(before, after);
            expect(adding.operations.map(item => item.kind)).toEqual(['createIndex']);
            const added = adding.toMigration('20261004010001_AddIndex', 'AddIndex');
            await contextMigrations(original).update([initial, added]);
            await assertEnforced();
            const removing = diffModelSnapshots(after, before);
            expect(removing.operations).toHaveLength(1);
            expect(removing.operations[0]).toMatchObject({ kind: 'dropIndex', name: mode === 'filtered' ? 'ux_profile_user_configured' : 'ux_profile_user_label' });
            const removed = removing.toMigration('20261004010002_RemoveIndex', 'RemoveIndex');
            const migrations = [initial, added, removed];
            await contextMigrations(original).update(migrations, { allowDataLoss: true });
            await assertEnforced();
            await contextMigrations(original).update(migrations, { target: added.id, allowDataLoss: true });
            await assertEnforced();
            await contextMigrations(original).update(migrations, { target: initial.id, allowDataLoss: true });
            await assertEnforced();
            expect(diffModelSnapshots(before, contextMigrations(original).createModelSnapshot()).hasChanges).toBe(false);
            await query('insert into ek_index_profiles (id, user_id, label) values (\'different-user\', \'user-2\', \'hidden\')');
        } finally {
            await cleanup();
        }
    } finally {
        await source.dispose();
    }
}
