import { generateDbPullCodeWithDiagnostics, type DatabaseSchemaSnapshot } from '../../packages/core/src/tooling';

describe('db pull lossy schema boundaries', () => {
    it('maps generated values and collations, and skips unsupported indexes', () => {
        const snapshot: DatabaseSchemaSnapshot = {
            schemas: [{
                name: '',
                tables: [{
                    schemaName: '',
                    tableName: 'users',
                    columns: [
                        {
                            name: 'id',
                            ordinal: 1,
                            storeType: 'bigint',
                            isNullable: false,
                            defaultSql: 'nextval(\'users_id_seq\')',
                            isStoreGenerated: true,
                        },
                        {
                            name: 'email',
                            ordinal: 2,
                            storeType: 'varchar(255)',
                            isNullable: false,
                            collation: 'utf8mb4_0900_ai_ci',
                        },
                    ],
                    primaryKey: { name: 'pk_users', columns: ['id'] },
                    indexes: [{
                        name: 'ux_users_email_active',
                        columns: ['email'],
                        isUnique: true,
                        unsupportedFeatures: [
                            'partial predicate',
                            'included columns',
                        ],
                    }],
                    foreignKeys: [],
                }],
            }],
        };

        const result = generateDbPullCodeWithDiagnostics(snapshot, {
            contextName: 'PulledDbContext',
            providerName: 'mysql',
        });
        const contextFile = result.files.find(
            file => file.path === 'pulled-db-context.ts',
        )?.contents ?? '';
        const messages = result.diagnostics.map(diagnostic => diagnostic.message);

        expect(contextFile).toContain(
            '.hasDefaultSql("nextval(\'users_id_seq\')")',
        );
        expect(contextFile).toContain('.valueGeneratedOnAdd()');
        expect(contextFile).toContain('.useCollation("utf8mb4_0900_ai_ci")');
        expect(contextFile).toContain(
            'uses unsupported partial predicate, included columns metadata',
        );
        expect(contextFile).not.toContain(
            'hasDatabaseName("ux_users_email_active")',
        );
        expect(messages).toEqual([
            'Column ""."users"."id" uses store type \'bigint\'; generated TypeScript type is \'string\'. Add a value converter or refine the generated property type.',
            'Index \'ux_users_email_active\' on ""."users" uses unsupported partial predicate, included columns metadata; generated starter skipped this index rather than changing its semantics.',
        ]);
    });
});
