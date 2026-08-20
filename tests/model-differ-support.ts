import type { ModelSnapshot } from '../packages/core/src/tooling';

export const emptySnapshot: ModelSnapshot = {
    formatVersion: 1,
    entities: [],
};

export const usersSnapshot: ModelSnapshot = {
    formatVersion: 1,
    entities: [{
        entityName: 'User',
        tableName: 'users',
        schemaName: 'app',
        keyProperty: 'id',
        ignoredProperties: [],
        properties: [
            { propertyName: 'id', columnName: 'id', columnType: 'uuid', isRequired: true, isPrimaryKey: true, isUnique: false, hasConverter: false, isConcurrencyToken: false, isVersion: false },
            { propertyName: 'email', columnName: 'email', columnType: 'text', isRequired: true, isPrimaryKey: false, isUnique: false, maxLength: 255, hasConverter: false, isConcurrencyToken: false, isVersion: false },
        ],
        indexes: [{ propertyNames: ['email'], isUnique: true, databaseName: 'ux_users_email' }],
        relationships: [],
        manyToManyRelationships: [],
    }],
};

export const usersWithNameSnapshot: ModelSnapshot = {
    ...usersSnapshot,
    entities: [{
        ...usersSnapshot.entities[0],
        properties: [
            ...usersSnapshot.entities[0].properties,
            { propertyName: 'name', columnName: 'name', columnType: 'text', isRequired: false, isPrimaryKey: false, isUnique: false, hasConverter: false, isConcurrencyToken: false, isVersion: false },
        ],
    }],
};

export const usersWithChangedEmailSnapshot: ModelSnapshot = {
    ...usersSnapshot,
    entities: [{
        ...usersSnapshot.entities[0],
        properties: usersSnapshot.entities[0].properties.map(property => property.propertyName === 'email'
            ? {
                ...property,
                columnType: 'varchar',
                maxLength: 320,
                isRequired: false,
                defaultValue: 'unknown@example.com',
            }
            : property),
    }],
};

export const usersWithRenamedEmailColumnSnapshot: ModelSnapshot = {
    ...usersSnapshot,
    entities: [{
        ...usersSnapshot.entities[0],
        properties: usersSnapshot.entities[0].properties.map(property => property.propertyName === 'email'
            ? { ...property, columnName: 'contact_email' }
            : property),
    }],
};

export const accountsSnapshot: ModelSnapshot = {
    ...usersSnapshot,
    entities: [{
        ...usersSnapshot.entities[0],
        entityName: 'Account',
        tableName: 'accounts',
    }],
};

export const usersWithRolesSnapshot: ModelSnapshot = {
    formatVersion: 1,
    entities: [
        usersSnapshot.entities[0],
        {
            entityName: 'Role',
            tableName: 'roles',
            schemaName: 'app',
            keyProperty: 'id',
            ignoredProperties: [],
            properties: [
                { propertyName: 'id', columnName: 'id', columnType: 'uuid', isRequired: true, isPrimaryKey: true, isUnique: false, hasConverter: false, isConcurrencyToken: false, isVersion: false },
            ],
            indexes: [],
            relationships: [],
            manyToManyRelationships: [],
        },
    ],
};

export const usersWithUserRolesSnapshot: ModelSnapshot = {
    ...usersWithRolesSnapshot,
    entities: [
        {
            ...usersWithRolesSnapshot.entities[0],
            manyToManyRelationships: [{
                navigationProperty: 'roles',
                targetEntityName: 'Role',
                joinTableName: 'user_roles',
                joinSchemaName: 'app',
                sourceForeignKeyColumn: 'user_id',
                targetForeignKeyColumn: 'role_id',
                sourceConstraintName: 'fk_user_roles_users_user_id',
                targetConstraintName: 'fk_user_roles_roles_role_id',
                deleteBehavior: 'cascade',
            }],
        },
        usersWithRolesSnapshot.entities[1],
    ],
};

export function postsSnapshot(deleteBehavior: 'cascade' | 'restrict'): ModelSnapshot {
    return {
        formatVersion: 1,
        entities: [
            usersSnapshot.entities[0],
            {
                entityName: 'Post',
                tableName: 'posts',
                schemaName: 'app',
                keyProperty: 'id',
                ignoredProperties: [],
                properties: [
                    { propertyName: 'id', columnName: 'id', columnType: 'uuid', isRequired: true, isPrimaryKey: true, isUnique: false, hasConverter: false, isConcurrencyToken: false, isVersion: false },
                    { propertyName: 'authorId', columnName: 'author_id', columnType: 'uuid', isRequired: true, isPrimaryKey: false, isUnique: false, hasConverter: false, isConcurrencyToken: false, isVersion: false },
                ],
                indexes: [],
                relationships: [{
                    navigationProperty: 'author',
                    principalEntityName: 'User',
                    inverseNavigationProperty: 'posts',
                    foreignKeyProperty: 'authorId',
                    deleteBehavior,
                    constraintName: 'fk_posts_users_author_id',
                }],
                manyToManyRelationships: [],
            },
        ],
    };
}
