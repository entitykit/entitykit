import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, EntityState } from '../src';
import { RecordingDatabaseConnection } from '../src/testing';
import { setMetadata } from './support/public-api-internals';

class ProfileUser {
    public id!: string;
    public profile!: Profile | null;
}

class Profile {
    public id!: string;
    public userId!: string;
    public user!: ProfileUser;
}

let connection: RecordingDatabaseConnection;

class ProfileContext extends DbContext {
    public users = this.set(ProfileUser);
    public profiles = this.set(Profile);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(connection);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(ProfileUser, entity => {
            entity.toTable('profile_users');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
        });

        model.entity(Profile, entity => {
            entity.toTable('profiles');
            entity.hasKey(profile => profile.id);
            entity.property(profile => profile.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(profile => profile.userId).hasColumnName('user_id').hasColumnType('text').isRequired();
            entity.hasOne(ProfileUser, profile => profile.user)
                .withOne(user => user.profile)
                .hasForeignKey(profile => profile.userId);
        });
    }
}

describe('relationship correctness', () => {
    beforeEach(() => {
        connection = new RecordingDatabaseConnection();
    });

    it('supports EF-style withOne metadata', () => {
        const db =  ProfileContext.create();
        const profileMetadata = setMetadata(db.profiles);

        expect(profileMetadata.relationships[0]).toMatchObject({
            navigationProperty: 'user',
            inverseNavigationProperty: 'profile',
            foreignKeyProperty: 'userId',
        });
    });

    it('deduplicates duplicate include paths and tracks loaded references', async () => {
        const db =  ProfileContext.create();
        connection.queueResult({ rows: [{ id: 'profile_1', user_id: 'usr_1' }], rowCount: 1 });
        connection.queueResult({ rows: [{ id: 'usr_1' }], rowCount: 1 });

        const profiles = await db.profiles
            .include(profile => profile.user)
            .include(profile => profile.user)
            .toArray();

        expect(connection.statements).toHaveLength(2);
        expect(profiles[0]?.user).toBeInstanceOf(ProfileUser);
        expect(db.entry(profiles[0])?.state).toBe(EntityState.Unchanged);
        expect(db.entry(profiles[0])?.isNavigationLoaded('user')).toBe(true);
    });
});
