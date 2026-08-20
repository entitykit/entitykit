import { ModelBuilder as ModelBuilderImplementation } from '../packages/core/src/model/model-builder';
import { DeleteBehavior } from '../packages/core/src';
import { SchemaSqlBuilder } from '../packages/core/src/schema/schema-sql-builder';

class User {
    public id!: string;
    public logins!: UserLogin[];
}

class UserLogin {
    public id!: string;
    public userId!: string;
    public user!: User;
    public provider!: string;
}

class MissingPrincipal {
    public id!: string;
}

describe('relationship metadata', () => {
    it('configures many-to-one metadata without enabling include loading', () => {
        const modelBuilder = new ModelBuilderImplementation();

        modelBuilder.entity(User, entity => {
            entity.toTable('users');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('uuid').isRequired();
        });

        modelBuilder.entity(UserLogin, entity => {
            entity.toTable('user_logins');
            entity.hasKey(login => login.id);
            entity.property(login => login.id).hasColumnName('id').hasColumnType('uuid').isRequired();
            entity.property(login => login.userId).hasColumnName('user_id').hasColumnType('uuid').isRequired();
            entity.property(login => login.provider).hasColumnName('provider').hasColumnType('text').isRequired();
            entity.hasOne(User, login => login.user)
                .withMany(user => user.logins)
                .hasForeignKey(login => login.userId)
                .onDelete(DeleteBehavior.Cascade)
                .hasConstraintName('fk_user_logins_users_user_id');
        });

        const model = modelBuilder.build();
        const relationship = model.getEntity(UserLogin).relationships[0];

        expect(relationship).toMatchObject({
            navigationProperty: 'user',
            inverseNavigationProperty: 'logins',
            foreignKeyProperty: 'userId',
            deleteBehavior: DeleteBehavior.Cascade,
            constraintName: 'fk_user_logins_users_user_id',
        });

        expect(new SchemaSqlBuilder().build(model)).toContain(
            'constraint "fk_user_logins_users_user_id" foreign key ("user_id") references "users" ("id") on delete cascade',
        );
    });

    it('fails when a relationship references an unregistered principal', () => {
        const modelBuilder = new ModelBuilderImplementation();
        modelBuilder.entity(UserLogin, entity => {
            entity.toTable('user_logins');
            entity.hasKey(login => login.id);
            entity.property(login => login.id).hasColumnName('id').hasColumnType('uuid').isRequired();
            entity.property(login => login.userId).hasColumnName('user_id').hasColumnType('uuid').isRequired();
            entity.property(login => login.provider).hasColumnName('provider').hasColumnType('text').isRequired();
            entity.hasOne(MissingPrincipal, login => login.user).hasForeignKey(login => login.userId);
        });

        expect(() => modelBuilder.build()).toThrow('references unregistered principal entity \'MissingPrincipal\'');
    });

    it('fails when a relationship does not configure a foreign key', () => {
        const modelBuilder = new ModelBuilderImplementation();
        modelBuilder.entity(User, entity => {
            entity.toTable('users');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('uuid').isRequired();
        });
        modelBuilder.entity(UserLogin, entity => {
            entity.toTable('user_logins');
            entity.hasKey(login => login.id);
            entity.property(login => login.id).hasColumnName('id').hasColumnType('uuid').isRequired();
            entity.property(login => login.userId).hasColumnName('user_id').hasColumnType('uuid').isRequired();
            entity.property(login => login.provider).hasColumnName('provider').hasColumnType('text').isRequired();
            entity.hasOne(User, login => login.user).withMany(user => user.logins);
        });

        expect(() => modelBuilder.build()).toThrow('must configure a foreign key');
    });
});
