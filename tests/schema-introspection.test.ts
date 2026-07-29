import { PostgresSchemaIntrospector } from '../src/providers/postgres';
import { generateDbPullCode } from '../src/tooling';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

describe('Postgres schema introspection', () => {
    it('builds a schema snapshot from Postgres catalog rows', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({
            rows: [
                {
                    table_schema: 'app',
                    table_name: 'users',
                    column_name: 'id',
                    ordinal_position: 1,
                    data_type: 'uuid',
                    udt_name: 'uuid',
                    character_maximum_length: null,
                    numeric_precision: null,
                    numeric_scale: null,
                    is_nullable: 'NO',
                    column_default: 'nextval(\'users_id_seq\'::regclass)',
                    is_identity: 'NO',
                },
                {
                    table_schema: 'app',
                    table_name: 'users',
                    column_name: 'tags',
                    ordinal_position: 3,
                    data_type: 'ARRAY',
                    udt_name: '_text',
                    character_maximum_length: null,
                    numeric_precision: null,
                    numeric_scale: null,
                    is_nullable: 'YES',
                    column_default: null,
                },
                {
                    table_schema: 'app',
                    table_name: 'users',
                    column_name: 'email',
                    ordinal_position: 2,
                    data_type: 'character varying',
                    udt_name: 'varchar',
                    character_maximum_length: 255,
                    numeric_precision: null,
                    numeric_scale: null,
                    is_nullable: 'NO',
                    column_default: null,
                },
                {
                    table_schema: 'app',
                    table_name: 'posts',
                    column_name: 'author_id',
                    ordinal_position: 1,
                    data_type: 'uuid',
                    udt_name: 'uuid',
                    character_maximum_length: null,
                    numeric_precision: null,
                    numeric_scale: null,
                    is_nullable: 'NO',
                    column_default: null,
                },
            ],
            rowCount: 4,
        });
        connection.queueResult({
            rows: [{ table_schema: 'app', table_name: 'users', constraint_name: 'pk_users', columns: '{id}' }],
            rowCount: 1,
        });
        connection.queueResult({
            rows: [{
                table_schema: 'app',
                table_name: 'users',
                index_name: 'ux_users_email',
                columns: ['email'],
                is_unique: true,
                has_predicate: true,
                has_expression: false,
                has_included_columns: true,
                has_non_default_opclass: false,
            }],
            rowCount: 1,
        });
        connection.queueResult({
            rows: [{
                table_schema: 'app',
                table_name: 'posts',
                constraint_name: 'fk_posts_users_author_id',
                columns: '{author_id}',
                foreign_table_schema: 'app',
                foreign_table_name: 'users',
                foreign_columns: '{id}',
                delete_rule: 'CASCADE',
            }],
            rowCount: 1,
        });

        const snapshot = await new PostgresSchemaIntrospector(connection).introspect({ schemas: ['app'] });

        expect(connection.statements.map(statement => statement.values)).toEqual([
            [['app']],
            [['app']],
            [['app']],
            [['app']],
            [['app']],
            [['app']],
        ]);
        expect(connection.statements[2]?.text).toContain('from pg_index');
        expect(connection.statements[2]?.text).toContain('array_agg(att.attname::text order by indexed_columns.ordinality)');
        expect(snapshot).toMatchObject({
            schemas: [
                {
                    name: 'app',
                    tables: [
                        {
                            tableName: 'posts',
                            columns: [{ name: 'author_id', storeType: 'uuid', isNullable: false }],
                            foreignKeys: [{ name: 'fk_posts_users_author_id', principalTableName: 'users', onDelete: 'cascade' }],
                        },
                        {
                            tableName: 'users',
                            primaryKey: { name: 'pk_users', columns: ['id'] },
                            columns: [
                                {
                                    name: 'id',
                                    storeType: 'uuid',
                                    isStoreGenerated: true,
                                    storeGeneration: {
                                        kind: 'sequence',
                                        name: 'users_id_seq',
                                    },
                                },
                                { name: 'email', storeType: 'varchar(255)' },
                                { name: 'tags', storeType: 'text[]' },
                            ],
                            indexes: [{
                                name: 'ux_users_email',
                                columns: ['email'],
                                isUnique: true,
                                unsupportedFeatures: [
                                    'partial predicate',
                                    'included columns',
                                ],
                            }],
                        },
                    ],
                },
            ],
        });
        expect(generateDbPullCode(snapshot)
            .map(file => file.contents).join('\n'))
            .toContain('.useSequence("users_id_seq")');
    });

    it('keeps alternate-key targets from referenced constraint metadata', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({
            rows: [
                {
                    table_schema: 'app',
                    table_name: 'posts',
                    column_name: 'author_email',
                    ordinal_position: 1,
                    data_type: 'text',
                    udt_name: 'text',
                    character_maximum_length: null,
                    numeric_precision: null,
                    numeric_scale: null,
                    is_nullable: 'NO',
                    column_default: null,
                },
                {
                    table_schema: 'auth',
                    table_name: 'users',
                    column_name: 'id',
                    ordinal_position: 1,
                    data_type: 'uuid',
                    udt_name: 'uuid',
                    character_maximum_length: null,
                    numeric_precision: null,
                    numeric_scale: null,
                    is_nullable: 'NO',
                    column_default: null,
                },
                {
                    table_schema: 'auth',
                    table_name: 'users',
                    column_name: 'email',
                    ordinal_position: 2,
                    data_type: 'text',
                    udt_name: 'text',
                    character_maximum_length: null,
                    numeric_precision: null,
                    numeric_scale: null,
                    is_nullable: 'NO',
                    column_default: null,
                },
            ],
            rowCount: 3,
        });
        connection.queueResult({
            rows: [{
                table_schema: 'auth',
                table_name: 'users',
                constraint_name: 'pk_users',
                columns: ['id'],
            }],
            rowCount: 1,
        });
        connection.queueResult({
            rows: [{
                table_schema: 'auth',
                table_name: 'users',
                index_name: 'uq_users_email',
                columns: ['email'],
                is_unique: true,
                has_predicate: false,
                has_expression: false,
                has_included_columns: false,
                has_non_default_opclass: false,
            }],
            rowCount: 1,
        });
        connection.queueResult({
            rows: [{
                table_schema: 'app',
                table_name: 'posts',
                constraint_name: 'fk_posts_auth_users_author_email',
                columns: ['author_email'],
                foreign_table_schema: 'auth',
                foreign_table_name: 'users',
                foreign_columns: ['email'],
                delete_rule: 'NO ACTION',
            }],
            rowCount: 1,
        });

        const snapshot = await new PostgresSchemaIntrospector(connection).introspect({ schemas: ['app', 'auth'] });
        const foreignKeySql = connection.statements[3]?.text ?? '';

        expect(foreignKeySql).toContain('rc.unique_constraint_schema');
        expect(foreignKeySql).toContain('pk_kcu.ordinal_position = kcu.position_in_unique_constraint');
        expect(foreignKeySql).not.toContain('ccu.table_schema = tc.table_schema');
        expect(snapshot.schemas[0]?.tables[0]?.foreignKeys[0]).toMatchObject({
            name: 'fk_posts_auth_users_author_email',
            principalSchemaName: 'auth',
            principalTableName: 'users',
            principalColumns: ['email'],
            onDelete: 'no action',
        });
        const generated = generateDbPullCode(snapshot)
            .map(file => file.contents)
            .join('\n');
        expect(generated).toContain('hasAlternateKey(row => row.email)');
        expect(generated).toContain('hasPrincipalKey(row => row.email)');
    });

});
