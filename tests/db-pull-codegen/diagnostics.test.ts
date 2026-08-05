import { generateDbPullCode, generateDbPullCodeWithDiagnostics, type DatabaseSchemaSnapshot } from '../../src/tooling';
import { compileGeneratedFiles } from './support';

describe('db pull diagnostics and conservative mappings', () => {
    it('returns diagnostics for generated starter code that needs review', () => {
        const snapshot: DatabaseSchemaSnapshot = {
            schemas: [{
                name: 'app',
                tables: [
                    {
                        schemaName: 'app',
                        tableName: 'pulled_db_contexts',
                        columns: [
                            { name: 'tenant_id', ordinal: 1, storeType: 'uuid', isNullable: false },
                            { name: 'user_id', ordinal: 2, storeType: 'uuid', isNullable: false },
                        ],
                        primaryKey: { name: 'pk_pulled_db_contexts', columns: ['tenant_id', 'user_id'] },
                        indexes: [],
                        foreignKeys: [],
                    },
                    {
                        schemaName: 'app',
                        tableName: 'posts',
                        columns: [
                            { name: 'id', ordinal: 1, storeType: 'uuid', isNullable: false },
                            { name: 'author_id', ordinal: 2, storeType: 'uuid', isNullable: false },
                            { name: 'review_state', ordinal: 3, storeType: 'review_state', isNullable: false },
                        ],
                        primaryKey: undefined,
                        indexes: [],
                        foreignKeys: [{
                            name: 'fk_posts_auth_users_author_id',
                            columns: ['author_id'],
                            principalSchemaName: 'auth',
                            principalTableName: 'users',
                            principalColumns: ['id'],
                            onDelete: 'cascade',
                        }],
                    },
                ],
            }],
        };

        const result = generateDbPullCodeWithDiagnostics(snapshot, { contextName: 'PulledDbContext' });

        expect(result.files.map(file => file.path)).toContain('pulled-db-context2.ts');
        expect(result.diagnostics.map(diagnostic => diagnostic.message)).toEqual([
            'Requested DbContext name \'PulledDbContext\' was rewritten to \'PulledDbContext2\' to avoid a generated entity name collision.',
            'Table "app"."posts" has no primary key; generated starter configures it with hasNoKey(). Review whether the table should remain keyless.',
            'Foreign key \'fk_posts_auth_users_author_id\' on "app"."posts" references "auth"."users" outside this db pull snapshot; relationship metadata was skipped.',
            'Column "app"."posts"."review_state" uses store type \'review_state\'; generated TypeScript type is \'unknown\'. Add a value converter or refine the generated property type.',
        ]);
        expect(result.diagnostics.map(diagnostic => diagnostic.category)).toEqual([
            'generated-name',
            'table',
            'relationship',
            'column',
        ]);
        expect(result.diagnostics).toHaveLength(4);
    });

    it('warns and skips indexes whose columns cannot be mapped to generated properties', () => {
        const snapshot: DatabaseSchemaSnapshot = {
            schemas: [{
                name: 'app',
                tables: [{
                    schemaName: 'app',
                    tableName: 'users',
                    columns: [
                        { name: 'id', ordinal: 1, storeType: 'uuid', isNullable: false },
                        { name: 'email', ordinal: 2, storeType: 'text', isNullable: false },
                    ],
                    primaryKey: { name: 'pk_users', columns: ['id'] },
                    indexes: [
                        { name: 'ix_users_email_lookup', columns: ['email', 'lower_email'], isUnique: false },
                        { name: 'ix_users_expression', columns: [], isUnique: false },
                    ],
                    foreignKeys: [],
                }],
            }],
        };

        const result = generateDbPullCodeWithDiagnostics(snapshot, { contextName: 'PulledDbContext' });
        const contextFile = result.files.find(file => file.path === 'pulled-db-context.ts')?.contents ?? '';

        expect(contextFile).toContain('Index \'ix_users_email_lookup\' on "app"."users" references column(s) lower_email');
        expect(contextFile).toContain('Index \'ix_users_expression\' on "app"."users" has no mapped columns');
        expect(contextFile).not.toContain('entity.hasIndex(row => row.email).hasDatabaseName("ix_users_email_lookup")');
        expect(contextFile).not.toContain('hasDatabaseName("ix_users_expression")');
        expect(result.diagnostics.map(diagnostic => diagnostic.message)).toEqual([
            'Index \'ix_users_email_lookup\' on "app"."users" references column(s) lower_email that were not mapped to generated properties; generated starter skipped this index.',
            'Index \'ix_users_expression\' on "app"."users" has no mapped columns; generated starter skipped this index. Review expression or provider-specific index metadata manually.',
        ]);
        expect(result.diagnostics.map(diagnostic => diagnostic.category)).toEqual(['index', 'index']);
        expect(compileGeneratedFiles(snapshot)).toEqual([]);
    });

    it('generates a composite key for a composite primary key', () => {
        const snapshot: DatabaseSchemaSnapshot = {
            schemas: [{
                name: 'app',
                tables: [{
                    schemaName: 'app',
                    tableName: 'tenant_users',
                    columns: [
                        { name: 'tenant_id', ordinal: 1, storeType: 'uuid', isNullable: false },
                        { name: 'user_id', ordinal: 2, storeType: 'uuid', isNullable: false },
                        { name: 'email', ordinal: 3, storeType: 'text', isNullable: false },
                    ],
                    primaryKey: { name: 'pk_tenant_users', columns: ['tenant_id', 'user_id'] },
                    indexes: [],
                    foreignKeys: [],
                }],
            }],
        };

        const files = generateDbPullCode(snapshot, { contextName: 'PulledDbContext' });
        const contextFile = files.find(file => file.path === 'pulled-db-context.ts')?.contents ?? '';

        // Key columns keep their constraint order.
        expect(contextFile).toContain('entity.hasKey(row => [row.tenantId, row.userId]);');
        expect(contextFile).not.toContain('maps the first key column only');
    });

    it('maps common Postgres store type edge cases and warns for conservative unknowns', () => {
        const snapshot: DatabaseSchemaSnapshot = {
            schemas: [{
                name: 'app',
                tables: [{
                    schemaName: 'app',
                    tableName: 'events',
                    columns: [
                        { name: 'id', ordinal: 1, storeType: 'uuid', isNullable: false },
                        { name: 'payload', ordinal: 2, storeType: 'jsonb', isNullable: false },
                        { name: 'payload_history', ordinal: 3, storeType: 'jsonb[]', isNullable: false },
                        { name: 'tags', ordinal: 4, storeType: 'text[]', isNullable: false },
                        { name: 'scores', ordinal: 5, storeType: 'integer[]', isNullable: false },
                        { name: 'retries', ordinal: 6, storeType: 'integer', isNullable: false },
                        { name: 'duration_ms', ordinal: 7, storeType: 'bigint', isNullable: false },
                        { name: 'price', ordinal: 8, storeType: 'numeric(12,2)', isNullable: false },
                        { name: 'measurements', ordinal: 9, storeType: 'decimal[]', isNullable: false },
                        { name: 'attachment', ordinal: 10, storeType: 'bytea', isNullable: true },
                        { name: 'start_time', ordinal: 11, storeType: 'time without time zone', isNullable: false },
                        { name: 'duration', ordinal: 12, storeType: 'interval', isNullable: false },
                        { name: 'status', ordinal: 13, storeType: 'event_status', isNullable: false },
                        { name: 'status_history', ordinal: 14, storeType: 'event_status[]', isNullable: false },
                    ],
                    primaryKey: { name: 'pk_events', columns: ['id'] },
                    indexes: [],
                    foreignKeys: [],
                }],
            }],
        };

        const result = generateDbPullCodeWithDiagnostics(snapshot, { contextName: 'PulledDbContext' });
        const eventFile = result.files.find(file => file.path === 'event.ts')?.contents ?? '';

        expect(eventFile).toContain('import type { JsonValue } from "entitykit";');
        expect(eventFile).toContain('payload!: JsonValue;');
        expect(eventFile).toContain('payloadHistory!: JsonValue[];');
        expect(eventFile).toContain('tags!: string[];');
        expect(eventFile).toContain('scores!: number[];');
        expect(eventFile).toContain('retries!: number;');
        expect(eventFile).toContain('durationMs!: string;');
        expect(eventFile).toContain('price!: string;');
        expect(eventFile).toContain('measurements!: string[];');
        expect(eventFile).toContain('attachment?: Buffer | null;');
        expect(eventFile).toContain('startTime!: string;');
        expect(eventFile).toContain('duration!: unknown;');
        expect(eventFile).toContain('status!: unknown;');
        expect(eventFile).toContain('statusHistory!: unknown[];');
        expect(result.diagnostics.map(diagnostic => diagnostic.message)).toEqual([
            'Column "app"."events"."duration_ms" uses store type \'bigint\'; generated TypeScript type is \'string\'. Add a value converter or refine the generated property type.',
            'Column "app"."events"."price" uses store type \'numeric(12,2)\'; generated TypeScript type is \'string\'. Add a value converter or refine the generated property type.',
            'Column "app"."events"."measurements" uses store type \'decimal[]\'; generated TypeScript type is \'string[]\'. Add a value converter or refine the generated property type.',
            'Column "app"."events"."duration" uses store type \'interval\'; generated TypeScript type is \'unknown\'. Add a value converter or refine the generated property type.',
            'Column "app"."events"."status" uses store type \'event_status\'; generated TypeScript type is \'unknown\'. Add a value converter or refine the generated property type.',
            'Column "app"."events"."status_history" uses store type \'event_status[]\'; generated TypeScript type is \'unknown[]\'. Add a value converter or refine the generated property type.',
        ]);
        expect(compileGeneratedFiles(snapshot)).toEqual([]);
    });

});
