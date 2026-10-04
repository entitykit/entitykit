import { ModelBuilder } from '../packages/core/src/model/model-builder';

class User {
    public id!: string; public tenantId!: string; public profile!: Profile;
}
class Profile {
    public id!: string; public userId!: string; public tenantId!: string; public user!: User;
}

describe('complete unique keys for one-to-one relationships', () => {
    it.each(['overlappingIndex', 'foreignSubsetOfPrimaryKey'] as const)(
        'retains foreign-key uniqueness for %s', mode => {
            const model = new ModelBuilder().entity(User, entity => {
                entity.toTable('index_users');
                entity.hasKey(row => mode === 'overlappingIndex' ? [row.id, row.tenantId] : row.id);
                entity.property(row => row.id).hasColumnType('text');
                entity.property(row => row.tenantId).hasColumnType('text');
            }).entity(Profile, entity => {
                entity.toTable('index_profiles');
                entity.hasKey(row => mode === 'overlappingIndex' ? row.id : [row.userId, row.tenantId]);
                entity.property(row => row.id).hasColumnType('text');
                entity.property(row => row.userId).hasColumnType('text');
                entity.property(row => row.tenantId).hasColumnType('text');
                entity.hasOne(User, row => row.user).withOne(row => row.profile)
                    .hasForeignKey(row => mode === 'overlappingIndex' ? [row.userId, row.tenantId] : row.userId);
                if (mode === 'overlappingIndex') entity.hasIndex(row => [row.userId, row.id]).isUnique();
            }).build();
            expect(model.getEntity(Profile).indexes).toContainEqual({
                propertyNames: mode === 'overlappingIndex' ? ['userId', 'tenantId'] : ['userId'], isUnique: true,
            });
        },
    );
    it.each([
        { reversed: false, structured: false }, { reversed: true, structured: false },
        { reversed: false, structured: true }, { reversed: true, structured: true },
    ])('reuses a complete composite key with reversed=$reversed, structured=$structured', ({ reversed, structured }) => {
        const model = new ModelBuilder().entity(User, entity => {
            entity.toTable('index_users');
            entity.hasKey(row => [row.id, row.tenantId]);
            entity.property(row => row.id).hasColumnType('text');
            entity.property(row => row.tenantId).hasColumnType('text');
        }).entity(Profile, entity => {
            entity.toTable('index_profiles');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text');
            entity.property(row => row.userId).hasColumnType('text');
            entity.property(row => row.tenantId).hasColumnType('text');
            entity.hasOne(User, row => row.user).withOne(row => row.profile).hasForeignKey(row => [row.userId, row.tenantId]);
            const parts = [
                { kind: 'property', propertyName: 'userId' }, { kind: 'property', propertyName: 'tenantId' },
            ] as const;
            const index = structured ? entity.hasIndex(reversed ? [...parts].reverse() : parts)
                : entity.hasIndex(row => reversed ? [row.tenantId, row.userId] : [row.userId, row.tenantId]);
            index.hasDatabaseName('ux_complete_user').isUnique();
        }).build();
        expect(model.getEntity(Profile).indexes).toHaveLength(1);
        expect(model.getEntity(Profile).indexes[0]).toMatchObject({
            isUnique: true, databaseName: 'ux_complete_user', propertyNames: reversed ? ['tenantId', 'userId'] : ['userId', 'tenantId'],
        });
    });
});
