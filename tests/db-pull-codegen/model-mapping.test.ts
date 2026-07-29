import * as migrations from '../../src/migrations/api';
import { generateDbPullCode, type DatabaseSchemaSnapshot } from '../../src/tooling';
import { compileGeneratedFiles, createGeneratedModelSnapshot } from './support';

describe('db pull model mapping', () => {
    it('generates entity classes and a mapped DbContext from an introspection snapshot', () => {
        const snapshot: DatabaseSchemaSnapshot = {
            schemas: [{
                name: 'app',
                tables: [
                    {
                        schemaName: 'app',
                        tableName: 'users',
                        columns: [
                            { name: 'id', ordinal: 1, storeType: 'uuid', isNullable: false },
                            { name: 'email', ordinal: 2, storeType: 'varchar(255)', isNullable: false },
                            { name: 'created_at', ordinal: 3, storeType: 'timestamp with time zone', isNullable: false, defaultSql: 'now()' },
                        ],
                        primaryKey: { name: 'pk_users', columns: ['id'] },
                        indexes: [{ name: 'ux_users_email', columns: ['email'], isUnique: true }],
                        foreignKeys: [],
                    },
                    {
                        schemaName: 'app',
                        tableName: 'posts',
                        columns: [
                            { name: 'id', ordinal: 1, storeType: 'uuid', isNullable: false },
                            { name: 'author_id', ordinal: 2, storeType: 'uuid', isNullable: false },
                            { name: 'title', ordinal: 3, storeType: 'text', isNullable: false },
                        ],
                        primaryKey: { name: 'pk_posts', columns: ['id'] },
                        indexes: [],
                        foreignKeys: [{
                            name: 'fk_posts_users_author_id',
                            columns: ['author_id'],
                            principalSchemaName: 'app',
                            principalTableName: 'users',
                            principalColumns: ['id'],
                            onDelete: 'cascade',
                        }],
                    },
                ],
            }],
        };

        const files = generateDbPullCode(snapshot, { contextName: 'PulledDbContext', connectionStringExpression: 'connectionString' });
        const userFile = files.find(file => file.path === 'user.ts')?.contents ?? '';
        const postFile = files.find(file => file.path === 'post.ts')?.contents ?? '';
        const contextFile = files.find(file => file.path === 'pulled-db-context.ts')?.contents ?? '';

        expect(userFile).toContain('export class User');
        expect(userFile).toContain('email!: string;');
        expect(userFile).toContain('createdAt!: Date;');
        expect(postFile).toContain('import { User } from "./user";');
        expect(postFile).toContain('author?: User | null;');
        expect(contextFile).toContain('export class PulledDbContext extends DbContext');
        expect(contextFile).toContain('users = this.set(User);');
        expect(contextFile).toContain('entity.toTable("users", "app")');
        expect(contextFile).toContain('entity.hasKey(row => row.id)');
        expect(contextFile).toContain('.hasDatabaseName("ux_users_email").isUnique();');
        expect(contextFile).toContain('entity.hasOne(User, row => row.author)');
        expect(contextFile).toContain('.onDelete(DeleteBehavior.Cascade)');
    });

    it('round-trips generated code into an EntityKit model snapshot', async () => {
        const snapshot: DatabaseSchemaSnapshot = {
            schemas: [{
                name: 'app',
                tables: [
                    {
                        schemaName: 'app',
                        tableName: 'users',
                        columns: [
                            { name: 'id', ordinal: 1, storeType: 'uuid', isNullable: false },
                            { name: 'email', ordinal: 2, storeType: 'varchar(255)', isNullable: false },
                            { name: 'created_at', ordinal: 3, storeType: 'timestamp with time zone', isNullable: false, defaultSql: 'now()' },
                        ],
                        primaryKey: { name: 'pk_users', columns: ['id'] },
                        indexes: [{ name: 'ux_users_email', columns: ['email'], isUnique: true }],
                        foreignKeys: [],
                    },
                    {
                        schemaName: 'app',
                        tableName: 'roles',
                        columns: [{ name: 'id', ordinal: 1, storeType: 'uuid', isNullable: false }],
                        primaryKey: { name: 'pk_roles', columns: ['id'] },
                        indexes: [],
                        foreignKeys: [],
                    },
                    {
                        schemaName: 'app',
                        tableName: 'posts',
                        columns: [
                            { name: 'id', ordinal: 1, storeType: 'uuid', isNullable: false },
                            { name: 'user_id', ordinal: 2, storeType: 'uuid', isNullable: false },
                            { name: 'reviewer_id', ordinal: 3, storeType: 'uuid', isNullable: true },
                            { name: 'title', ordinal: 4, storeType: 'text', isNullable: false, defaultSql: '\'untitled\'' },
                        ],
                        primaryKey: { name: 'pk_posts', columns: ['id'] },
                        indexes: [{ name: 'ix_posts_user_id', columns: ['user_id'], isUnique: false }],
                        foreignKeys: [
                            {
                                name: 'fk_posts_users_user_id',
                                columns: ['user_id'],
                                principalSchemaName: 'app',
                                principalTableName: 'users',
                                principalColumns: ['id'],
                                onDelete: 'cascade',
                            },
                            {
                                name: 'fk_posts_users_reviewer_id',
                                columns: ['reviewer_id'],
                                principalSchemaName: 'app',
                                principalTableName: 'users',
                                principalColumns: ['id'],
                                onDelete: 'set null',
                            },
                        ],
                    },
                    {
                        schemaName: 'app',
                        tableName: 'user_roles',
                        columns: [
                            { name: 'user_id', ordinal: 1, storeType: 'uuid', isNullable: false },
                            { name: 'role_id', ordinal: 2, storeType: 'uuid', isNullable: false },
                        ],
                        primaryKey: { name: 'pk_user_roles', columns: ['user_id', 'role_id'] },
                        indexes: [],
                        foreignKeys: [
                            {
                                name: 'fk_user_roles_users_user_id',
                                columns: ['user_id'],
                                principalSchemaName: 'app',
                                principalTableName: 'users',
                                principalColumns: ['id'],
                                onDelete: 'cascade',
                            },
                            {
                                name: 'fk_user_roles_roles_role_id',
                                columns: ['role_id'],
                                principalSchemaName: 'app',
                                principalTableName: 'roles',
                                principalColumns: ['id'],
                                onDelete: 'cascade',
                            },
                        ],
                    },
                ],
            }],
        };

        const expectedSnapshot: migrations.ModelSnapshot = {
            formatVersion: 1,
            entities: [
                {
                    entityName: 'Post',
                    tableName: 'posts',
                    schemaName: 'app',
                    keyProperty: 'id',
                    keyProperties: ['id'],
                    ignoredProperties: [],
                    properties: [
                        { propertyName: 'id', columnName: 'id', columnType: 'uuid', isRequired: true, isPrimaryKey: true, isUnique: false, hasConverter: false, isConcurrencyToken: false, isVersion: false },
                        { propertyName: 'userId', columnName: 'user_id', columnType: 'uuid', isRequired: true, isPrimaryKey: false, isUnique: false, hasConverter: false, isConcurrencyToken: false, isVersion: false },
                        { propertyName: 'reviewerId', columnName: 'reviewer_id', columnType: 'uuid', isRequired: false, isPrimaryKey: false, isUnique: false, hasConverter: false, isConcurrencyToken: false, isVersion: false },
                        { propertyName: 'title', columnName: 'title', columnType: 'text', isRequired: true, isPrimaryKey: false, isUnique: false, defaultSql: '\'untitled\'', hasConverter: false, isConcurrencyToken: false, isVersion: false },
                    ],
                    indexes: [{ propertyNames: ['userId'], isUnique: false, databaseName: 'ix_posts_user_id' }],
                    relationships: [
                        { navigationProperty: 'user', principalEntityName: 'User', foreignKeyProperty: 'userId',
                            foreignKeyProperties: ['userId'], deleteBehavior: 'cascade', constraintName: 'fk_posts_users_user_id' },
                        { navigationProperty: 'reviewer', principalEntityName: 'User', foreignKeyProperty: 'reviewerId',
                            foreignKeyProperties: ['reviewerId'], deleteBehavior: 'set null', constraintName: 'fk_posts_users_reviewer_id' },
                    ],
                    manyToManyRelationships: [],
                },
                {
                    entityName: 'Role',
                    tableName: 'roles',
                    schemaName: 'app',
                    keyProperty: 'id',
                    keyProperties: ['id'],
                    ignoredProperties: [],
                    properties: [
                        { propertyName: 'id', columnName: 'id', columnType: 'uuid', isRequired: true, isPrimaryKey: true, isUnique: false, hasConverter: false, isConcurrencyToken: false, isVersion: false },
                    ],
                    indexes: [],
                    relationships: [],
                    manyToManyRelationships: [],
                },
                {
                    entityName: 'User',
                    tableName: 'users',
                    schemaName: 'app',
                    keyProperty: 'id',
                    keyProperties: ['id'],
                    ignoredProperties: [],
                    properties: [
                        { propertyName: 'id', columnName: 'id', columnType: 'uuid', isRequired: true, isPrimaryKey: true, isUnique: false, hasConverter: false, isConcurrencyToken: false, isVersion: false },
                        { propertyName: 'email', columnName: 'email', columnType: 'varchar(255)', isRequired: true, isPrimaryKey: false, isUnique: false, hasConverter: false, isConcurrencyToken: false, isVersion: false },
                        { propertyName: 'createdAt', columnName: 'created_at', columnType: 'timestamp with time zone', isRequired: true, isPrimaryKey: false, isUnique: false, defaultSql: 'now()', hasConverter: false, isConcurrencyToken: false, isVersion: false },
                    ],
                    indexes: [{ propertyNames: ['email'], isUnique: true, databaseName: 'ux_users_email' }],
                    relationships: [],
                    manyToManyRelationships: [{
                        navigationProperty: 'roles',
                        targetEntityName: 'Role',
                        inverseNavigationProperty: 'users',
                        joinTableName: 'user_roles',
                        joinSchemaName: 'app',
                        primaryKeyName: 'pk_user_roles',
                        sourceForeignKeyColumn: 'user_id',
                        sourceForeignKeyColumns: ['user_id'],
                        targetForeignKeyColumn: 'role_id',
                        targetForeignKeyColumns: ['role_id'],
                        sourceConstraintName: 'fk_user_roles_users_user_id',
                        targetConstraintName: 'fk_user_roles_roles_role_id',
                        deleteBehavior: 'cascade',
                    }],
                },
            ],
        };
        const generatedSnapshot = await createGeneratedModelSnapshot(snapshot);

        expect(compileGeneratedFiles(snapshot)).toEqual([]);
        expect(generatedSnapshot).toEqual(expectedSnapshot);
        expect(migrations.diffModelSnapshots(expectedSnapshot, generatedSnapshot)).toMatchObject({
            hasChanges: false,
            operations: [],
        });
    });

});
