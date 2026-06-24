import { generateDbPullCode, generateDbPullCodeWithDiagnostics, type DatabaseSchemaSnapshot } from '../../src/tooling';

describe('db pull many-to-many relationship generation', () => {
    it('infers simple many-to-many join tables instead of generating join entities', () => {
        const snapshot: DatabaseSchemaSnapshot = {
            schemas: [{
                name: 'app',
                tables: [
                    {
                        schemaName: 'app',
                        tableName: 'users',
                        columns: [{ name: 'id', ordinal: 1, storeType: 'uuid', isNullable: false }],
                        primaryKey: { name: 'pk_users', columns: ['id'] },
                        indexes: [],
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

        const files = generateDbPullCode(snapshot, { contextName: 'PulledDbContext' });
        const userFile = files.find(file => file.path === 'user.ts')?.contents ?? '';
        const roleFile = files.find(file => file.path === 'role.ts')?.contents ?? '';
        const contextFile = files.find(file => file.path === 'pulled-db-context.ts')?.contents ?? '';

        expect(files.some(file => file.path === 'user-role.ts')).toBe(false);
        expect(userFile).toContain('import { Role } from "./role";');
        expect(userFile).toContain('roles!: Role[];');
        expect(roleFile).toContain('import { User } from "./user";');
        expect(roleFile).toContain('users!: User[];');
        expect(contextFile).not.toContain('userRoles = this.set(UserRole);');
        expect(contextFile).toContain('entity.hasManyToMany(Role, row => row.roles)');
        expect(contextFile).toContain('.withMany(row => row.users)');
        expect(contextFile).toContain('.usingJoinTable("user_roles", join => {');
        expect(contextFile).toContain('join.hasSchema("app");');
        expect(contextFile).toContain('join.primaryKeyName("pk_user_roles");');
        expect(contextFile).toContain('join.sourceForeignKey("user_id");');
        expect(contextFile).toContain('join.targetForeignKey("role_id");');
        expect(contextFile).toContain('join.sourceConstraintName("fk_user_roles_users_user_id");');
        expect(contextFile).toContain('join.targetConstraintName("fk_user_roles_roles_role_id");');
    });

    it('uses collision-safe many-to-many navigation names for repeated entity pairs', () => {
        const snapshot: DatabaseSchemaSnapshot = {
            schemas: [{
                name: 'app',
                tables: [
                    {
                        schemaName: 'app',
                        tableName: 'users',
                        columns: [{ name: 'id', ordinal: 1, storeType: 'uuid', isNullable: false }],
                        primaryKey: { name: 'pk_users', columns: ['id'] },
                        indexes: [],
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
                    {
                        schemaName: 'app',
                        tableName: 'user_managed_groups',
                        columns: [
                            { name: 'user_id', ordinal: 1, storeType: 'uuid', isNullable: false },
                            { name: 'group_id', ordinal: 2, storeType: 'uuid', isNullable: false },
                        ],
                        primaryKey: { name: 'pk_user_managed_groups', columns: ['user_id', 'group_id'] },
                        indexes: [],
                        foreignKeys: [
                            {
                                name: 'fk_user_managed_groups_users_user_id',
                                columns: ['user_id'],
                                principalSchemaName: 'app',
                                principalTableName: 'users',
                                principalColumns: ['id'],
                                onDelete: 'cascade',
                            },
                            {
                                name: 'fk_user_managed_groups_groups_group_id',
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

        const files = generateDbPullCode(snapshot, { contextName: 'PulledDbContext' });
        const userFile = files.find(file => file.path === 'user.ts')?.contents ?? '';
        const groupFile = files.find(file => file.path === 'group.ts')?.contents ?? '';
        const contextFile = files.find(file => file.path === 'pulled-db-context.ts')?.contents ?? '';

        expect(files.some(file => file.path === 'user-group.ts')).toBe(false);
        expect(files.some(file => file.path === 'user-managed-group.ts')).toBe(false);
        expect(userFile).toContain('groups!: Group[];');
        expect(userFile).toContain('groupsNavigation!: Group[];');
        expect(groupFile).toContain('users!: User[];');
        expect(groupFile).toContain('usersNavigation!: User[];');
        expect(contextFile).toContain('entity.hasManyToMany(Group, row => row.groups)');
        expect(contextFile).toContain('.usingJoinTable("user_groups", join => {');
        expect(contextFile).toContain('entity.hasManyToMany(Group, row => row.groupsNavigation)');
        expect(contextFile).toContain('.usingJoinTable("user_managed_groups", join => {');
        expect(contextFile).toContain('.withMany(row => row.usersNavigation)');
    });

    it('keeps payload join tables as explicit entities', () => {
        const snapshot: DatabaseSchemaSnapshot = {
            schemas: [{
                name: 'app',
                tables: [
                    {
                        schemaName: 'app',
                        tableName: 'users',
                        columns: [{ name: 'id', ordinal: 1, storeType: 'uuid', isNullable: false }],
                        primaryKey: { name: 'pk_users', columns: ['id'] },
                        indexes: [],
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
                        tableName: 'user_roles',
                        columns: [
                            { name: 'user_id', ordinal: 1, storeType: 'uuid', isNullable: false },
                            { name: 'role_id', ordinal: 2, storeType: 'uuid', isNullable: false },
                            { name: 'assigned_at', ordinal: 3, storeType: 'timestamp with time zone', isNullable: false },
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

        const result = generateDbPullCodeWithDiagnostics(snapshot);
        const files = result.files;

        expect(files.some(file => file.path === 'user-role.ts')).toBe(true);
        expect(result.diagnostics.map(diagnostic => diagnostic.message)).toEqual([
            'Table "app"."user_roles" looks like a join table with payload or ambiguous columns; generated starter keeps it as an explicit entity. Review whether it should stay explicit or be modeled manually.',
        ]);
        expect(result.diagnostics.map(diagnostic => diagnostic.category)).toEqual(['unsupported-schema']);
    });

});
