import { generateDbPullCodeWithDiagnostics } from '../packages/core/src/tooling';
import { buildPostgresSchemaSnapshot } from '../packages/postgres/src/postgres-schema-snapshot';
import { compileGeneratedFiles } from './db-pull-codegen/support';

describe('Postgres rich schema introspection', () => {
    it('preserves identity mode and sequence options separately from defaults', () => {
        const snapshot = buildPostgresSchemaSnapshot([{
            table_schema: 'app',
            table_name: 'counters',
            table_type: 'BASE TABLE',
            column_name: 'id',
            ordinal_position: 1,
            data_type: 'bigint',
            udt_name: 'int8',
            character_maximum_length: null,
            numeric_precision: 64,
            numeric_scale: 0,
            is_nullable: 'NO',
            column_default: null,
            is_identity: 'YES',
            identity_generation: 'ALWAYS',
            identity_start: '100',
            identity_increment: '5',
            identity_minimum: '10',
            identity_maximum: '10000',
            identity_cycle: 'YES',
            identity_cache: '20',
            owned_sequence_schema: 'app',
            owned_sequence_name: 'counters_id_seq',
            collation_name: null,
            is_generated: 'NEVER',
            generation_expression: null,
        }], [], [], []);

        expect(snapshot.schemas[0]?.tables[0]?.columns[0]).toMatchObject({
            defaultSql: undefined,
            isStoreGenerated: true,
            storeGeneration: {
                kind: 'identity',
                mode: 'always',
                startValue: '100',
                incrementBy: '5',
                minValue: '10',
                maxValue: '10000',
                isCyclic: true,
                cache: 20,
            },
        });
        const generated = generateDbPullCodeWithDiagnostics(snapshot).files
            .map(file => file.contents)
            .join('\n');
        expect(generated).toContain('.useIdentityColumn({ mode: "always"');
        expect(generated).toContain('startValue: BigInt("100")');
    });

    it('preserves views, generated columns, checks, sequences, and rich indexes', () => {
        const snapshot = buildPostgresSchemaSnapshot([
            {
                table_schema: 'app',
                table_name: 'report',
                table_type: 'VIEW',
                column_name: 'total',
                ordinal_position: 1,
                data_type: 'integer',
                udt_name: 'int4',
                character_maximum_length: null,
                numeric_precision: 32,
                numeric_scale: 0,
                is_nullable: 'YES',
                column_default: null,
                is_identity: 'NO',
                collation_name: null,
                is_generated: 'NEVER',
                generation_expression: null,
            },
            {
                table_schema: 'app',
                table_name: 'users',
                table_type: 'BASE TABLE',
                column_name: 'normalized_email',
                ordinal_position: 1,
                data_type: 'text',
                udt_name: 'text',
                character_maximum_length: null,
                numeric_precision: null,
                numeric_scale: null,
                is_nullable: 'YES',
                column_default: null,
                is_identity: 'NO',
                collation_name: 'C',
                is_generated: 'ALWAYS',
                generation_expression: 'lower(email)',
            },
            {
                table_schema: 'app',
                table_name: 'users',
                table_type: 'BASE TABLE',
                column_name: 'display_name',
                ordinal_position: 2,
                data_type: 'text',
                udt_name: 'text',
                character_maximum_length: null,
                numeric_precision: null,
                numeric_scale: null,
                is_nullable: 'YES',
                column_default: null,
                is_identity: 'NO',
                collation_name: null,
                is_generated: 'NEVER',
                generation_expression: null,
            },
        ], [], [{
            table_schema: 'app',
            table_name: 'users',
            index_name: 'ix_users_normalized_active',
            columns: ['normalized_email'],
            key_parts: ['normalized_email'],
            included_columns: ['display_name'],
            predicate: 'deleted_at IS NULL',
            is_unique: false,
            has_predicate: true,
            has_expression: false,
            has_included_columns: true,
            has_non_default_opclass: false,
        }], [], [{
            table_schema: 'app',
            table_name: 'users',
            constraint_name: 'ck_users_email',
            expression: 'email <> \'\'::text',
        }], [{
            schemaname: 'app',
            sequencename: 'user_numbers',
            data_type: 'bigint',
            start_value: '100',
            min_value: '1',
            max_value: '999999',
            increment_by: '10',
            cycle: false,
            cache_size: 5,
        }]);
        const report = snapshot.schemas[0]?.tables.find(table => table.tableName === 'report');
        const users = snapshot.schemas[0]?.tables.find(table => table.tableName === 'users');
        expect(report?.objectType).toBe('view');
        expect(users?.columns[0]).toMatchObject({
            name: 'normalized_email',
            collation: 'C',
            generatedExpression: 'lower(email)',
            generatedStored: true,
        });
        expect(users?.checkConstraints).toEqual([
            { name: 'ck_users_email', sql: 'email <> \'\'::text' },
        ]);
        expect(users?.indexes[0]).toMatchObject({
            name: 'ix_users_normalized_active',
            keyParts: [{ kind: 'column', name: 'normalized_email' }],
            includedColumns: ['display_name'],
            filter: 'deleted_at IS NULL',
        });
        expect(snapshot.schemas[0]?.sequences).toEqual([
            expect.objectContaining({ name: 'user_numbers', incrementBy: '10', cache: 5 }),
        ]);
        const pulled = generateDbPullCodeWithDiagnostics(snapshot);
        const generated = pulled.files
            .map(file => file.contents)
            .join('\n');
        expect(pulled.diagnostics).toHaveLength(1);
        expect(pulled.diagnostics[0]?.category).toBe('table');
        expect(pulled.diagnostics[0]?.message)
            .toContain('"app"."users" has no primary key');
        expect(generated).toContain('entity.toView("report", "app")');
        expect(generated).toContain('model.hasSequence("user_numbers"');
        expect(generated).toContain('.hasComputedColumnSql("lower(email)", true)');
        expect(generated).toContain('.includeProperties(row => row.displayName)');
        expect(generated).toContain('.hasFilter("deleted_at IS NULL")');
        expect(compileGeneratedFiles(snapshot)).toEqual([]);
    });

    it('rejects invalid sequence integers before generating TypeScript', () => {
        expect(() => generateDbPullCodeWithDiagnostics({
            schemas: [{
                name: 'app',
                tables: [],
                sequences: [{
                    name: 'unsafe',
                    schemaName: 'app',
                    startValue: '1); process.exit(1); (',
                    isCyclic: false,
                }],
            }],
        })).toThrow('is not a valid integer');
    });

    it('reports non-btree indexes instead of changing their access method', () => {
        const snapshot = buildPostgresSchemaSnapshot([{
            table_schema: 'app',
            table_name: 'documents',
            table_type: 'BASE TABLE',
            column_name: 'search_vector',
            ordinal_position: 1,
            data_type: 'tsvector',
            udt_name: 'tsvector',
            character_maximum_length: null,
            numeric_precision: null,
            numeric_scale: null,
            is_nullable: 'YES',
            column_default: null,
            is_identity: 'NO',
            collation_name: null,
            is_generated: 'NEVER',
            generation_expression: null,
        }], [], [{
            table_schema: 'app',
            table_name: 'documents',
            index_name: 'ix_documents_search',
            columns: ['search_vector'],
            key_parts: ['search_vector'],
            included_columns: [],
            predicate: null,
            is_unique: false,
            has_predicate: false,
            has_expression: false,
            has_included_columns: false,
            has_non_default_opclass: false,
            access_method: 'gin',
            is_valid: true,
        }], []);

        const pulled = generateDbPullCodeWithDiagnostics(snapshot);
        expect(pulled.diagnostics.map(diagnostic => diagnostic.message))
            .toEqual(expect.arrayContaining([
                expect.stringContaining('unsupported access method \'gin\''),
            ]));
        expect(pulled.files.map(file => file.contents).join('\n'))
            .not.toContain('hasDatabaseName("ix_documents_search")');
    });
});
