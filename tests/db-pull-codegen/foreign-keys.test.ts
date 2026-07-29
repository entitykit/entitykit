import { generateDbPullCode, generateDbPullCodeWithDiagnostics, type DatabaseSchemaSnapshot } from '../../src/tooling';
import {
    compileGeneratedFiles,
    createGeneratedModelSnapshot,
} from './support';

describe('db pull foreign-key relationship generation', () => {
    it('uses collision-safe foreign-key navigation names', () => {
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
                        tableName: 'posts',
                        columns: [
                            { name: 'id', ordinal: 1, storeType: 'uuid', isNullable: false },
                            { name: 'user', ordinal: 2, storeType: 'text', isNullable: false },
                            { name: 'user_id', ordinal: 3, storeType: 'uuid', isNullable: false },
                        ],
                        primaryKey: { name: 'pk_posts', columns: ['id'] },
                        indexes: [],
                        foreignKeys: [{
                            name: 'fk_posts_users_user_id',
                            columns: ['user_id'],
                            principalSchemaName: 'app',
                            principalTableName: 'users',
                            principalColumns: ['id'],
                            onDelete: 'no action',
                        }],
                    },
                ],
            }],
        };

        const files = generateDbPullCode(snapshot, { contextName: 'PulledDbContext' });
        const postFile = files.find(file => file.path === 'post.ts')?.contents ?? '';
        const contextFile = files.find(file => file.path === 'pulled-db-context.ts')?.contents ?? '';

        expect(postFile).toContain('user!: string;');
        expect(postFile).toContain('userId!: string;');
        expect(postFile).toContain('userNavigation?: User | null;');
        expect(contextFile).toContain('entity.hasOne(User, row => row.userNavigation)');
        expect(contextFile).toContain('.hasForeignKey(row => row.userId)');
    });

    it('emits TODO comments for foreign keys whose principal table was not pulled', () => {
        const snapshot: DatabaseSchemaSnapshot = {
            schemas: [{
                name: 'app',
                tables: [{
                    schemaName: 'app',
                    tableName: 'posts',
                    columns: [
                        { name: 'id', ordinal: 1, storeType: 'uuid', isNullable: false },
                        { name: 'author_id', ordinal: 2, storeType: 'uuid', isNullable: false },
                    ],
                    primaryKey: { name: 'pk_posts', columns: ['id'] },
                    indexes: [],
                    foreignKeys: [{
                        name: 'fk_posts_auth_users_author_id',
                        columns: ['author_id'],
                        principalSchemaName: 'auth',
                        principalTableName: 'users',
                        principalColumns: ['id'],
                        onDelete: 'cascade',
                    }],
                }],
            }],
        };

        const files = generateDbPullCode(snapshot, { contextName: 'PulledDbContext' });
        const postFile = files.find(file => file.path === 'post.ts')?.contents ?? '';
        const contextFile = files.find(file => file.path === 'pulled-db-context.ts')?.contents ?? '';

        expect(postFile).toContain('Foreign key "fk_posts_auth_users_author_id" references "auth"."users"');
        expect(postFile).not.toContain('author?:');
        expect(contextFile).toContain('Skipped relationship "fk_posts_auth_users_author_id" because "auth"."users" was not included');
        expect(contextFile).not.toContain('entity.hasOne(');
    });

    it('models foreign keys to unique indexes as alternate-key relationships', async () => {
        const snapshot: DatabaseSchemaSnapshot = {
            schemas: [{
                name: 'app',
                tables: [
                    {
                        schemaName: 'app',
                        tableName: 'users',
                        columns: [
                            { name: 'id', ordinal: 1, storeType: 'uuid', isNullable: false },
                            { name: 'email', ordinal: 2, storeType: 'text', isNullable: false },
                        ],
                        primaryKey: { name: 'pk_users', columns: ['id'] },
                        indexes: [{
                            name: 'uq_users_email',
                            columns: ['email'],
                            isUnique: true,
                            includedColumns: ['id'],
                        }],
                        foreignKeys: [],
                    },
                    {
                        schemaName: 'app',
                        tableName: 'posts',
                        columns: [
                            { name: 'id', ordinal: 1, storeType: 'uuid', isNullable: false },
                            { name: 'author_email', ordinal: 2, storeType: 'text', isNullable: false },
                        ],
                        primaryKey: { name: 'pk_posts', columns: ['id'] },
                        indexes: [],
                        foreignKeys: [{
                            name: 'fk_posts_users_author_email',
                            columns: ['author_email'],
                            principalSchemaName: 'app',
                            principalTableName: 'users',
                            principalColumns: ['email'],
                            onDelete: 'no action',
                        }],
                    },
                ],
            }],
        };

        const result = generateDbPullCodeWithDiagnostics(snapshot, {
            contextName: 'PulledDbContext',
        });
        const postFile = result.files.find(
            file => file.path === 'post.ts',
        )?.contents ?? '';
        const contextFile = result.files.find(
            file => file.path === 'pulled-db-context.ts',
        )?.contents ?? '';

        expect(postFile).toContain('authorEmailNavigation?: User | null;');
        expect(contextFile).toContain(
            'entity.hasAlternateKey(row => row.email).hasDatabaseName("uq_users_email");',
        );
        expect(contextFile).toContain(
            'entity.hasIndex(row => row.email).hasDatabaseName("uq_users_email").isUnique().includeProperties(row => row.id);',
        );
        expect(contextFile).toContain(
            'entity.hasOne(User, row => row.authorEmailNavigation)',
        );
        expect(contextFile).toContain('.hasForeignKey(row => row.authorEmail)');
        expect(contextFile).toContain('.hasPrincipalKey(row => row.email)');
        expect(result.diagnostics).toEqual([]);
        expect(compileGeneratedFiles(snapshot)).toEqual([]);

        const generated = await createGeneratedModelSnapshot(snapshot);
        expect(generated.entities.find(entity => entity.entityName === 'User')
            ?.alternateKeys).toEqual([{
            propertyNames: ['email'],
            databaseName: 'uq_users_email',
        }]);
        expect(generated.entities.find(entity => entity.entityName === 'User')
            ?.indexes).toEqual([{
            propertyNames: ['email'],
            includedPropertyNames: ['id'],
            isUnique: true,
            databaseName: 'uq_users_email',
        }]);
        expect(generated.entities.find(entity => entity.entityName === 'Post')
            ?.relationships[0]?.principalKeyProperties).toEqual(['email']);
    });

    it('does not infer key cardinality from partial or expression uniqueness', () => {
        const snapshot: DatabaseSchemaSnapshot = {
            schemas: [{
                name: 'app',
                tables: [
                    {
                        schemaName: 'app',
                        tableName: 'users',
                        columns: [
                            { name: 'id', ordinal: 1, storeType: 'uuid', isNullable: false },
                            { name: 'email', ordinal: 2, storeType: 'text', isNullable: false },
                        ],
                        primaryKey: { name: 'pk_users', columns: ['id'] },
                        indexes: [{
                            name: 'uq_users_active_email',
                            columns: ['email'],
                            isUnique: true,
                            filter: 'deleted_at is null',
                        }],
                        foreignKeys: [],
                    },
                    {
                        schemaName: 'app',
                        tableName: 'posts',
                        columns: [
                            { name: 'id', ordinal: 1, storeType: 'uuid', isNullable: false },
                            { name: 'author_email', ordinal: 2, storeType: 'text', isNullable: false },
                        ],
                        primaryKey: { name: 'pk_posts', columns: ['id'] },
                        indexes: [{
                            name: 'uq_posts_active_author',
                            columns: ['author_email'],
                            keyParts: [
                                { kind: 'column', name: 'author_email' },
                                { kind: 'expression', expression: 'lower(id::text)' },
                            ],
                            isUnique: true,
                        }],
                        foreignKeys: [{
                            name: 'fk_posts_users_author_email',
                            columns: ['author_email'],
                            principalSchemaName: 'app',
                            principalTableName: 'users',
                            principalColumns: ['email'],
                            onDelete: 'no action',
                        }],
                    },
                ],
            }],
        };

        const result = generateDbPullCodeWithDiagnostics(snapshot);
        const contextFile = result.files.find(file =>
            file.path === 'app-db-context.ts')?.contents ?? '';

        expect(contextFile).not.toContain('.hasPrincipalKey(');
        expect(contextFile).not.toContain('.withOne()');
        expect(result.diagnostics.map(diagnostic => diagnostic.message)).toEqual(
            expect.arrayContaining([
                expect.stringContaining(
                    'without a supported primary or unique key',
                ),
            ]),
        );
    });

});
