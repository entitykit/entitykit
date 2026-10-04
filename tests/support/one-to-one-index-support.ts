import { DbContext, type EntityKitDataSource, type ModelBuilder } from '../../packages/core/src';
import { contextMigrations, diffModelSnapshots } from '../../packages/core/src/migrations/api';
import { createSqliteDataSource } from '../../packages/sqlite/src';
import { createPostgresDataSource } from '../../packages/postgres/src';
import { createMySqlDataSource } from '../../packages/mysql/src';

export type RelationshipIndexMode = 'original' | 'propertyFirst' | 'expressionFirst' | 'filtered' | 'ordinary'
    | 'filteredUnnamed' | 'propertyFirstCollision' | 'expressionFirstCollision'
    | 'propertyFirstCaseCollision' | 'expressionFirstCaseCollision';
class IndexUser {
    public id!: string;
    public profile!: IndexProfile | null;
}
class IndexProfile {
    public id!: string;
    public userId!: string;
    public label!: string;
    public user!: IndexUser;
}
export class RelationshipIndexContext extends DbContext {
    public readonly users = this.set(IndexUser);
    public readonly profiles = this.set(IndexProfile);
    constructor(source: EntityKitDataSource, private readonly mode: RelationshipIndexMode) {
        super(source);
    }
    protected override model(model: ModelBuilder): void {
        model.entity(IndexUser, entity => {
            entity.toTable('ek_index_users').hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('varchar(64)').isRequired();
        });
        model.entity(IndexProfile, entity => {
            entity.toTable('ek_index_profiles').hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('varchar(64)').isRequired();
            entity.property(row => row.userId).hasColumnName('user_id').hasColumnType('varchar(64)').isRequired();
            entity.property(row => row.label).hasColumnType('varchar(64)').isRequired();
            entity.hasOne(IndexUser, row => row.user).withOne(row => row.profile).hasForeignKey(row => row.userId);
            if (this.mode === 'ordinary' || this.mode === 'filtered' || this.mode === 'filteredUnnamed') {
                const index = entity.hasIndex(row => row.userId).isUnique();
                if (this.mode !== 'filteredUnnamed') index.hasDatabaseName('ux_profile_user_configured');
                if (this.mode !== 'ordinary') index.hasFilter('label <> \'hidden\'');
            } else if (this.mode !== 'original') {
                const property = { kind: 'property', propertyName: 'userId' } as const;
                const expression = { kind: 'expression', expression: 'lower(label)' } as const;
                entity.hasIndex(this.mode.startsWith('propertyFirst')
                    ? [property, expression] : [expression, property])
                    .hasDatabaseName(this.mode.endsWith('CaseCollision') ? 'UX_EK_INDEX_PROFILES_USER_ID'
                        : this.mode.endsWith('Collision') ? 'ux_ek_index_profiles_user_id' : 'ux_profile_user_label').isUnique();
            }
        });
    }
}

export function defineOneToOneIndexProviderTests(provider: 'sqlite' | 'postgres' | 'mysql', url: () => string): void {
    const modes: RelationshipIndexMode[] = ['original', 'propertyFirst', 'expressionFirst', 'ordinary'];
    if (provider === 'postgres') modes.push('propertyFirstCaseCollision', 'expressionFirstCaseCollision');
    if (provider !== 'mysql') modes.push('filtered');
    it.each(modes)('enforces one profile per user in a fresh %s model', async mode => {
        await qualify(provider, url(), mode, false);
    });
    const upgrades: RelationshipIndexMode[] = ['propertyFirst', 'expressionFirst'];
    if (provider !== 'mysql') upgrades.push('filtered');
    it.each(upgrades)('retains populated relationship uniqueness when upgrading to %s', async mode => {
        await qualify(provider, url(), mode, true);
    });
}

async function qualify(provider: 'sqlite' | 'postgres' | 'mysql', url: string, mode: RelationshipIndexMode, upgrade: boolean): Promise<void> {
    const source = provider === 'sqlite' ? createSqliteDataSource(url) : provider === 'postgres' ? createPostgresDataSource(url) : createMySqlDataSource(url);
    try {
        await using db = source.createContext(RelationshipIndexContext, upgrade ? 'original' : mode);
        const clean = async (): Promise<void> => {
            await db.database.connection.query({ text: 'drop table if exists ek_index_profiles', values: [] });
        };
        await clean();
        await db.database.connection.query({ text: 'drop table if exists ek_index_users', values: [] });
        await db.database.connection.query({ text: 'drop table if exists __entitykit_migrations', values: [] });
        try {
            await db.database.ensureCreated();
            const query = async (text: string): ReturnType<typeof db.database.connection.query> => db.database.connection.query({ text, values: [] });
            await query('insert into ek_index_users (id) values (\'user-1\'), (\'user-2\')');
            await query('insert into ek_index_profiles (id, user_id, label) values (\'profile-1\', \'user-1\', \'first\')');
            if (upgrade) {
                await using target = source.createContext(RelationshipIndexContext, mode);
                const before = contextMigrations(db).createModelSnapshot();
                const after = contextMigrations(target).createModelSnapshot();
                const diff = diffModelSnapshots(before, after);
                expect(diff.operations.filter(operation => operation.kind === 'dropIndex')).toEqual([]);
                await contextMigrations(db).update([diff.toMigration('20261004002000_AddMixedIndex', 'AddMixedIndex')]);
            }
            const label = mode === 'filtered' ? 'hidden' : 'second';
            if (mode === 'filtered') {
                await query('update ek_index_profiles set label = \'hidden\' where id = \'profile-1\'');
            }
            await expect(query(`insert into ek_index_profiles (id, user_id, label) values ('profile-2', 'user-1', '${label}')`)).rejects.toThrow();
            await query('insert into ek_index_profiles (id, user_id, label) values (\'profile-3\', \'user-2\', \'third\')');
            expect((await query('select id from ek_index_profiles order by id')).rows).toEqual([{ id: 'profile-1' }, { id: 'profile-3' }]);
        } finally {
            await clean();
            await db.database.connection.query({ text: 'drop table if exists ek_index_users', values: [] });
            await db.database.connection.query({ text: 'drop table if exists __entitykit_migrations', values: [] });
        }
    } finally {
        await source.dispose();
    }
}
