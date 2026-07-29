import { ModelBuilder as ModelBuilderImplementation } from '../src/model/model-builder';
import {
    DeleteBehavior,
} from '../src';
import type { EntityMetadata } from '../src/model/entity-metadata';
import type { ManyToManyMetadata } from '../src/model/many-to-many-metadata';

export class Role {
    public id!: string;
}

export class User {
    public id!: string;
    public email!: string;
    public name!: string;
    public createdAt!: Date;
    public roles!: Role[];

    constructor(data?: Partial<User>) {
        Object.assign(this, data);
    }
}

export function createUserMetadata(): EntityMetadata<User> {
    const model = new ModelBuilderImplementation();
    model.entity(User, entity => {
        entity.toTable('users');
        entity.hasKey(user => user.id);
        entity.property(user => user.id).hasColumnName('id').hasColumnType('text').isRequired();
        entity.property(user => user.email).hasColumnName('email').hasColumnType('text').isRequired();
        entity.property(user => user.name).hasColumnName('display_name').hasColumnType('text').isRequired();
        entity.property(user => user.createdAt).hasColumnName('created_at').hasColumnType('timestamptz').isRequired();
    });
    return model.build().getEntity(User);
}

export function createUserRolesRelationship(): ManyToManyMetadata<User> {
    return {
        navigationProperty: 'roles',
        targetEntity: Role,
        joinTableName: 'user_roles',
        joinSchemaName: 'app',
        sourceForeignKeyColumns: ['tenant_id', 'user_id'],
        targetForeignKeyColumns: ['role_id'],
        deleteBehavior: DeleteBehavior.Cascade,
    };
}
