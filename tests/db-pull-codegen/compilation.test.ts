import { type DatabaseSchemaSnapshot } from '../../src/tooling';
import { compileGeneratedFiles } from './support';

describe('db pull generated project compilation', () => {
    it('emits TypeScript that typechecks for generated starter projects', () => {
        const snapshot: DatabaseSchemaSnapshot = {
            schemas: [{
                name: 'app',
                tables: [
                    {
                        schemaName: 'app',
                        tableName: 'users',
                        columns: [
                            { name: 'id', ordinal: 1, storeType: 'uuid', isNullable: false },
                            { name: 'class', ordinal: 2, storeType: 'text', isNullable: false },
                        ],
                        primaryKey: { name: 'pk_users', columns: ['id'] },
                        indexes: [{ name: 'ix_users_class', columns: ['class'], isUnique: false }],
                        foreignKeys: [],
                    },
                    {
                        schemaName: 'app',
                        tableName: 'groups',
                        columns: [{ name: 'id', ordinal: 1, storeType: 'uuid', isNullable: false }],
                        primaryKey: { name: 'pk_groups', columns: ['id'] },
                        indexes: [],
                        foreignKeys: [],
                    },
                    {
                        schemaName: 'app',
                        tableName: 'posts',
                        columns: [
                            { name: 'id', ordinal: 1, storeType: 'uuid', isNullable: false },
                            { name: 'user', ordinal: 2, storeType: 'text', isNullable: false },
                            { name: 'user_id', ordinal: 3, storeType: 'uuid', isNullable: false },
                            { name: 'first-name', ordinal: 4, storeType: 'text', isNullable: false },
                            { name: 'first_name', ordinal: 5, storeType: 'text', isNullable: true },
                        ],
                        primaryKey: { name: 'pk_posts', columns: ['id'] },
                        indexes: [{
                            name: 'ix_posts_names',
                            columns: ['first-name', 'first_name'],
                            isUnique: false,
                        }],
                        foreignKeys: [{
                            name: 'fk_posts_users_user_id',
                            columns: ['user_id'],
                            principalSchemaName: 'app',
                            principalTableName: 'users',
                            principalColumns: ['id'],
                            onDelete: 'no action',
                        }],
                    },
                    {
                        schemaName: 'app',
                        tableName: 'user_groups',
                        columns: [
                            { name: 'user_id', ordinal: 1, storeType: 'uuid', isNullable: false },
                            { name: 'group_id', ordinal: 2, storeType: 'uuid', isNullable: false },
                        ],
                        primaryKey: { name: 'pk_user_groups', columns: ['user_id', 'group_id'] },
                        indexes: [],
                        foreignKeys: [
                            {
                                name: 'fk_user_groups_users_user_id',
                                columns: ['user_id'],
                                principalSchemaName: 'app',
                                principalTableName: 'users',
                                principalColumns: ['id'],
                                onDelete: 'cascade',
                            },
                            {
                                name: 'fk_user_groups_groups_group_id',
                                columns: ['group_id'],
                                principalSchemaName: 'app',
                                principalTableName: 'groups',
                                principalColumns: ['id'],
                                onDelete: 'cascade',
                            },
                        ],
                    },
                ],
            }],
        };

        expect(compileGeneratedFiles(snapshot)).toEqual([]);
    });
});
