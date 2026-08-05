import { generateDbPullCode, generateDbPullCodeWithDiagnostics, type DatabaseSchemaSnapshot } from '../../src/tooling';
import { compileGeneratedFiles } from './support';

describe('db pull code generation for MySQL', () => {
    // Store types as the MySQL introspector reports them (COLUMN_TYPE), with an
    // empty schema for the connection's own database.
    const mysqlSnapshot: DatabaseSchemaSnapshot = {
        schemas: [{
            name: '',
            tables: [{
                schemaName: '',
                tableName: 'reading',
                columns: [
                    { name: 'id', ordinal: 1, storeType: 'char(36)', isNullable: false },
                    { name: 'region', ordinal: 2, storeType: 'varchar(255)', isNullable: false },
                    { name: 'is_active', ordinal: 3, storeType: 'tinyint(1)', isNullable: false },
                    { name: 'recorded_at', ordinal: 4, storeType: 'datetime(3)', isNullable: false },
                    { name: 'seen_on', ordinal: 5, storeType: 'datetime', isNullable: true },
                    { name: 'payload', ordinal: 6, storeType: 'json', isNullable: false },
                    { name: 'score', ordinal: 7, storeType: 'int', isNullable: false },
                    { name: 'counter', ordinal: 8, storeType: 'int unsigned', isNullable: true },
                    { name: 'quantity', ordinal: 9, storeType: 'mediumint', isNullable: true },
                    { name: 'big', ordinal: 10, storeType: 'bigint', isNullable: false },
                    { name: 'ratio', ordinal: 11, storeType: 'double', isNullable: true },
                    { name: 'weight', ordinal: 12, storeType: 'float', isNullable: true },
                    { name: 'amount', ordinal: 13, storeType: 'decimal(12,4)', isNullable: true },
                    { name: 'kind', ordinal: 14, storeType: 'enum(\'alpha\',\'beta\',\'gamma\')', isNullable: false },
                    { name: 'flags', ordinal: 15, storeType: 'set(\'x\',\'y\')', isNullable: true },
                    { name: 'blob_data', ordinal: 16, storeType: 'blob', isNullable: true },
                ],
                primaryKey: { name: 'reading_pkey', columns: ['id', 'region'] },
                indexes: [{ name: 'ix_reading_score', columns: ['score'], isUnique: false }],
                foreignKeys: [],
            }],
        }],
    };

    it('wires the MySQL provider and leaves the table unqualified', () => {
        const files = generateDbPullCode(mysqlSnapshot, { contextName: 'PulledDbContext', providerName: 'mysql' });
        const contextFile = files.find(file => file.path === 'pulled-db-context.ts')?.contents ?? '';

        expect(contextFile).toContain('import { mySqlProviderServices } from "entitykit/mysql";');
        expect(contextFile).toContain('options.useProvider(mySqlProviderServices, process.env.DATABASE_URL!);');
        expect(contextFile).not.toContain('usePostgres');
        // An empty schema (MySQL's own database) is never emitted as a table
        // qualifier or a create-schema, which would pin a database name.
        expect(contextFile).toContain('entity.toTable("reading");');
        expect(contextFile).not.toContain('entity.toTable("reading", "");');
    });

    it('maps MySQL store types to the right TypeScript types', () => {
        const result = generateDbPullCodeWithDiagnostics(mysqlSnapshot, { contextName: 'PulledDbContext', providerName: 'mysql' });
        const readingFile = result.files.find(file => file.path === 'reading.ts')?.contents ?? '';

        expect(readingFile).toContain('id!: string;');
        expect(readingFile).toContain('region!: string;');
        expect(readingFile).toContain('isActive!: boolean;');   // tinyint(1), not a small int
        expect(readingFile).toContain('recordedAt!: Date;');    // datetime(3)
        expect(readingFile).toContain('seenOn?: Date | null;'); // bare datetime (also a SQLite spelling)
        expect(readingFile).toContain('import type { JsonValue } from "entitykit";');
        expect(readingFile).toContain('payload!: JsonValue;');
        expect(readingFile).toContain('score!: number;');       // int, previously mapped to unknown
        expect(readingFile).toContain('counter?: number | null;');  // int unsigned
        expect(readingFile).toContain('quantity?: number | null;'); // mediumint
        expect(readingFile).toContain('big!: string;');         // bigint stays string (precision)
        expect(readingFile).toContain('ratio?: number | null;');    // double
        expect(readingFile).toContain('weight?: number | null;');   // float
        expect(readingFile).toContain('amount?: string | null;');   // decimal (precision)
        expect(readingFile).toContain('kind!: "alpha" | "beta" | "gamma";'); // enum union
        expect(readingFile).toContain('flags?: string | null;');    // set
        expect(readingFile).toContain('blobData?: Buffer | null;'); // blob

        // Only the genuinely lossy types warn — not the newly recognized ones.
        const flagged = result.diagnostics.map(diagnostic => diagnostic.message).join('\n');
        expect(flagged).toContain('\'bigint\'');
        expect(flagged).toContain('\'decimal(12,4)\'');
        expect(flagged).toContain('\'set(\'x\',\'y\')\'');
        expect(flagged).not.toContain('\'int\'');
        expect(flagged).not.toContain('\'tinyint(1)\'');
        expect(flagged).not.toContain('\'datetime(3)\'');
    });

    it('emits entity code that typechecks', () => {
    // Compiled with the default (Postgres) wiring, since the entity files are
    // identical across providers and the compile harness maps only `entitykit`.
        expect(compileGeneratedFiles(mysqlSnapshot)).toEqual([]);
    });

    it('preserves the case of enum members in the union type', () => {
        const snapshot: DatabaseSchemaSnapshot = {
            schemas: [{
                name: '',
                tables: [{
                    schemaName: '',
                    tableName: 'document',
                    columns: [
                        { name: 'id', ordinal: 1, storeType: 'char(36)', isNullable: false },
                        { name: 'state', ordinal: 2, storeType: 'enum(\'Draft\',\'InReview\',\'Published\')', isNullable: false },
                    ],
                    primaryKey: { name: 'document_pkey', columns: ['id'] },
                    indexes: [],
                    foreignKeys: [],
                }],
            }],
        };

        const file = generateDbPullCode(snapshot, { contextName: 'PulledDbContext', providerName: 'mysql' })
            .find(candidate => candidate.path === 'document.ts')?.contents ?? '';
        // Enum values are case-sensitive in the database; the union must match.
        expect(file).toContain('state!: "Draft" | "InReview" | "Published";');
    });
});
