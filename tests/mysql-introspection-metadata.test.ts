import { buildSnapshot } from '../src/providers/mysql/mysql-introspect-snapshot';
import { generateDbPullCode, generateDbPullCodeWithDiagnostics } from '../src/tooling';
import type {
    ColumnRow,
    StatisticRow,
} from '../src/providers/mysql/mysql-introspect-queries';

describe('MySQL introspection semantic metadata', () => {
    it('keeps auto-increment, collation, and prefix-index warnings', () => {
        const snapshot = buildSnapshot(
            [{ table_schema: 'app', table_name: 'users' }],
            [
                {
                    table_schema: 'app',
                    table_name: 'users',
                    column_name: 'id',
                    ordinal_position: 1,
                    column_type: 'bigint unsigned',
                    is_nullable: 'NO',
                    column_default: null,
                    extra: 'auto_increment',
                    collation_name: null,
                },
                {
                    table_schema: 'app',
                    table_name: 'users',
                    column_name: 'email',
                    ordinal_position: 2,
                    column_type: 'varchar(255)',
                    is_nullable: 'NO',
                    column_default: null,
                    extra: '',
                    collation_name: 'utf8mb4_0900_ai_ci',
                },
            ],
            [
                {
                    table_schema: 'app',
                    table_name: 'users',
                    index_name: 'PRIMARY',
                    non_unique: 0,
                    seq_in_index: 1,
                    column_name: 'id',
                    sub_part: null,
                },
                {
                    table_schema: 'app',
                    table_name: 'users',
                    index_name: 'ix_users_email_prefix',
                    non_unique: 1,
                    seq_in_index: 1,
                    column_name: 'email',
                    sub_part: 16,
                },
            ],
            [],
            'app',
        );

        const table = snapshot.schemas[0].tables[0];
        expect(table.columns).toEqual([
            expect.objectContaining({
                name: 'id',
                isStoreGenerated: true,
                storeGeneration: { kind: 'autoIncrement' },
            }),
            expect.objectContaining({
                name: 'email',
                collation: 'utf8mb4_0900_ai_ci',
            }),
        ]);
        expect(table.indexes).toEqual([{
            name: 'ix_users_email_prefix',
            columns: ['email'],
            keyParts: [{ kind: 'column', name: 'email' }],
            isUnique: false,
            unsupportedFeatures: ['column prefix length'],
        }]);
        const generated = generateDbPullCode(snapshot, { providerName: 'mysql' })
            .map(file => file.contents).join('\n');
        expect(generated).toContain('.hasColumnType("bigint unsigned")');
        expect(generated).toContain('.useAutoIncrement()');
    });

    it('preserves foreign keys that target a unique natural key', () => {
        const columns = [
            mysqlColumn('users', 'id', 1),
            mysqlColumn('users', 'email', 2),
            mysqlColumn('posts', 'id', 1),
            mysqlColumn('posts', 'author_email', 2),
        ];
        const snapshot = buildSnapshot(
            [
                { table_schema: 'app', table_name: 'users' },
                { table_schema: 'app', table_name: 'posts' },
            ],
            columns,
            [
                mysqlIndex('users', 'PRIMARY', 'id', 0),
                mysqlIndex('users', 'uq_users_email', 'email', 0),
                mysqlIndex('posts', 'PRIMARY', 'id', 0),
                mysqlIndex('posts', 'fk_posts_users_email', 'author_email', 1),
            ],
            [{
                table_schema: 'app',
                table_name: 'posts',
                constraint_name: 'fk_posts_users_email',
                column_name: 'author_email',
                ordinal_position: 1,
                referenced_table_schema: 'app',
                referenced_table_name: 'users',
                referenced_column_name: 'email',
                delete_rule: 'CASCADE',
            }],
            'app',
        );

        const post = snapshot.schemas[0]?.tables.find(table =>
            table.tableName === 'posts');
        expect(post?.foreignKeys[0]?.principalColumns).toEqual(['email']);
        const generated = generateDbPullCode(snapshot, { providerName: 'mysql' })
            .map(file => file.contents)
            .join('\n');
        expect(generated).toContain('hasAlternateKey(row => row.email)');
        expect(generated).toContain('hasPrincipalKey(row => row.email)');
    });

    it('warns and emits runtime generation semantics for an unsupported composite auto-increment position', () => {
        const snapshot = buildSnapshot(
            [{ table_schema: 'app', table_name: 'tenant_counters' }],
            [{
                ...mysqlColumn('tenant_counters', 'tenant_id', 1),
                column_type: 'varchar(40)',
            }, {
                ...mysqlColumn('tenant_counters', 'id', 2),
                column_type: 'bigint unsigned',
                extra: 'auto_increment',
                collation_name: null,
            }],
            [{
                ...mysqlIndex('tenant_counters', 'PRIMARY', 'tenant_id', 0),
                seq_in_index: 1,
            }, {
                ...mysqlIndex('tenant_counters', 'PRIMARY', 'id', 0),
                seq_in_index: 2,
            }],
            [],
            'app',
        );

        const result = generateDbPullCodeWithDiagnostics(snapshot, {
            providerName: 'mysql',
        });
        const source = result.files.map(file => file.contents).join('\n');

        expect(source).not.toContain('.useAutoIncrement()');
        expect(source).toContain('.valueGeneratedOnAdd()');
        expect(result.diagnostics.some(diagnostic =>
            diagnostic.category === 'unsupported-schema' &&
            diagnostic.message.includes(
                'auto-increment column must be the first primary-key column',
            ))).toBe(true);
    });

    it('preserves views, generated columns, checks, and expression indexes', () => {
        const snapshot = buildSnapshot([
            { table_schema: 'app', table_name: 'users', table_type: 'BASE TABLE' },
            { table_schema: 'app', table_name: 'user_report', table_type: 'VIEW' },
        ], [{
            ...mysqlColumn('users', 'email', 1),
            collation_name: 'utf8mb4_0900_ai_ci',
        }, {
            ...mysqlColumn('users', 'normalized_email', 2),
            extra: 'STORED GENERATED',
            generation_expression: 'lower(`email`)',
        }, {
            ...mysqlColumn('user_report', 'total', 1),
            column_type: 'bigint',
        }], [{
            ...mysqlIndex('users', 'ix_users_lower_email', '', 1),
            column_name: null,
            expression: 'lower(`email`)',
        }], [], 'app', [{
            constraint_schema: 'app',
            table_name: 'users',
            constraint_name: 'ck_users_email',
            check_clause: '`email` <> _utf8mb4\'\'',
        }]);

        const users = snapshot.schemas[0]?.tables.find(table =>
            table.tableName === 'users');
        const view = snapshot.schemas[0]?.tables.find(table =>
            table.tableName === 'user_report');
        expect(view?.objectType).toBe('view');
        expect(users?.columns).toEqual(expect.arrayContaining([
            expect.objectContaining({
                name: 'normalized_email',
                generatedExpression: 'lower(`email`)',
                generatedStored: true,
            }),
        ]));
        expect(users?.checkConstraints).toEqual([{
            name: 'ck_users_email',
            sql: '`email` <> _utf8mb4\'\'',
        }]);
        expect(users?.indexes).toEqual([
            expect.objectContaining({
                name: 'ix_users_lower_email',
                keyParts: [{
                    kind: 'expression',
                    expression: 'lower(`email`)',
                }],
            }),
        ]);

        const generated = generateDbPullCode(snapshot, { providerName: 'mysql' })
            .map(file => file.contents)
            .join('\n');
        expect(generated).toContain('entity.toView("user_report")');
        expect(generated).toContain('.useCollation("utf8mb4_0900_ai_ci")');
        expect(generated).toContain('.hasComputedColumnSql("lower(`email`)", true)');
        expect(generated).toContain('hasCheckConstraint("ck_users_email"');
        expect(generated).toContain('hasExpressionIndex(["lower(`email`)"])');
    });

    it('marks descending and non-btree indexes as review-required', () => {
        const snapshot = buildSnapshot([{
            table_schema: 'app',
            table_name: 'documents',
            table_type: 'BASE TABLE',
        }], [
            mysqlColumn('documents', 'body', 1),
        ], [{
            ...mysqlIndex('documents', 'ix_documents_body', 'body', 1),
            collation: 'D',
            index_type: 'FULLTEXT',
        }], [], 'app');

        expect(snapshot.schemas[0]?.tables[0]?.indexes[0]?.unsupportedFeatures)
            .toEqual([
                'descending key order',
                'index type \'FULLTEXT\'',
            ]);
    });
});

function mysqlColumn(
    table: string,
    column: string,
    ordinal: number,
): ColumnRow {
    return {
        table_schema: 'app',
        table_name: table,
        column_name: column,
        ordinal_position: ordinal,
        column_type: 'varchar(255)',
        is_nullable: 'NO' as const,
        column_default: null,
        extra: '',
        collation_name: 'utf8mb4_bin',
    };
}

function mysqlIndex(
    table: string,
    name: string,
    column: string,
    nonUnique: number,
): StatisticRow {
    return {
        table_schema: 'app',
        table_name: table,
        index_name: name,
        non_unique: nonUnique,
        seq_in_index: 1,
        column_name: column,
        sub_part: null,
    };
}
