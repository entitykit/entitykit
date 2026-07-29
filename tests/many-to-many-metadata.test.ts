import { ModelBuilder as ModelBuilderImplementation } from '../src/model/model-builder';
import type { ModelBuilder } from '../src';
import { DeleteBehavior } from '../src';
import { SchemaSqlBuilder } from '../src/schema/schema-sql-builder';

class User {
    public id!: string;
    public roles!: Role[];
}

class Role {
    public id!: string;
    public users!: User[];
}

function configure(model: ModelBuilder): void {
    model.entity(User, entity => {
        entity.toTable('users', 'app');
        entity.hasKey(user => user.id);
        entity.property(user => user.id).hasColumnName('id').hasColumnType('uuid').isRequired();
        entity.hasManyToMany(Role, user => user.roles)
            .withMany(role => role.users)
            .usingJoinTable('user_roles', join => {
                join.hasSchema('app');
                join.sourceForeignKey('user_id');
                join.targetForeignKey('role_id');
                join.sourceConstraintName('fk_user_roles_users_user_id');
                join.targetConstraintName('fk_user_roles_roles_role_id');
            })
            .onDelete(DeleteBehavior.Cascade);
    });

    model.entity(Role, entity => {
        entity.toTable('roles', 'app');
        entity.hasKey(role => role.id);
        entity.property(role => role.id).hasColumnName('id').hasColumnType('uuid').isRequired();
    });
}

describe('many-to-many relationship metadata', () => {
    it('stores join table metadata and emits schema SQL', () => {
        const builder = new ModelBuilderImplementation();
        configure(builder);

        const model = builder.build();
        const user = model.getEntity(User);

        expect(user.manyToManyRelationships).toMatchObject([{ navigationProperty: 'roles', joinTableName: 'user_roles', sourceForeignKeyColumn: 'user_id', targetForeignKeyColumn: 'role_id' }]);
        expect(model.toSnapshot().entities.find(entity => entity.entityName === 'User')?.manyToManyRelationships).toMatchObject([{ navigationProperty: 'roles', targetEntityName: 'Role', joinTableName: 'user_roles' }]);
        expect(new SchemaSqlBuilder().build(model)).toContain('create table if not exists "app"."user_roles" (\n  "user_id" uuid not null,\n  "role_id" uuid not null,\n  primary key ("user_id", "role_id"),\n  constraint "fk_user_roles_users_user_id" foreign key ("user_id") references "app"."users" ("id") on delete cascade,\n  constraint "fk_user_roles_roles_role_id" foreign key ("role_id") references "app"."roles" ("id") on delete cascade\n);');
    });

    it('validates join table and foreign key configuration', () => {
        const missingJoin = new ModelBuilderImplementation();
        missingJoin.entity(User, entity => {
            entity.toTable('users');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('uuid').isRequired();
            entity.hasManyToMany(Role, user => user.roles);
        });
        missingJoin.entity(Role, entity => {
            entity.toTable('roles');
            entity.hasKey(role => role.id);
            entity.property(role => role.id).hasColumnName('id').hasColumnType('uuid').isRequired();
        });

        expect(() => missingJoin.build()).toThrow('must configure a join table');

        const missingColumns = new ModelBuilderImplementation();
        missingColumns.entity(User, entity => {
            entity.toTable('users');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnName('id').hasColumnType('uuid').isRequired();
            entity.hasManyToMany(Role, user => user.roles).usingJoinTable('user_roles');
        });
        missingColumns.entity(Role, entity => {
            entity.toTable('roles');
            entity.hasKey(role => role.id);
            entity.property(role => role.id).hasColumnName('id').hasColumnType('uuid').isRequired();
        });

        expect(() => missingColumns.build()).toThrow('must configure source and target foreign key columns');
    });
});
