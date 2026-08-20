import { requireDefined } from '../support/require-defined';
import * as entitykit from '../../packages/core/src';
import { generateDbPullCode, generateDbPullCodeWithDiagnostics, type DatabaseSchemaSnapshot, type GeneratedCodeFile } from '../../packages/core/src/tooling';
import { MySqlDatabaseConnection, MySqlSchemaIntrospector, mySqlProviderServices } from '../../packages/mysql/src';
import * as mysqlProvider from '../../packages/mysql/src';
import { loadGeneratedDbContext } from '../support/load-generated-db-context';

const url = process.env.MYSQL_URL ?? process.env.MYSQL_DATABASE_URL;
const shouldRun = process.env.RUN_MYSQL_TESTS === 'true' && Boolean(url);
const maybe = shouldRun ? describe : describe.skip;

/**
 * MySQL schema introspection (`db pull`) against a live server. The centre of
 * the test is a lossless round-trip: an EntityKit-created schema is introspected,
 * regenerated into model code, that code's DDL is applied to a clean database,
 * and re-introspecting it yields the same column store types — proving db pull
 * neither loses nor invents structure. It also proves the generated context
 * wires MySQL (not Postgres) by connecting through it.
 */

// A DbContext whose model uses EntityKit's provider-neutral column types, so the
// MySQL dialect maps them to real MySQL types this test then reads back.
class Reading {
    public id!: string;
    public region!: string;
    public isActive!: boolean;
    public recordedAt!: Date;
    public payload!: { unit: string; samples: number[] };
    public score!: number;
    public big!: string;
    public ratio!: number | null;
    public label!: string | null;

    constructor(data?: Partial<Reading>) {
        Object.assign(this, data);
    }
}

class ReadingDbContext extends entitykit.DbContext {
    public readings = this.set(Reading);

    protected override configure(options: entitykit.DbContextOptionsBuilder): void {
        options.useProvider(mySqlProviderServices, requireDefined(url));
    }

    protected override model(model: entitykit.ModelBuilder): void {
        model.entity(Reading, entity => {
            entity.toTable('ek_pull_reading');
            entity.hasKey(reading => [reading.id, reading.region]);
            entity.property(reading => reading.id).hasColumnName('id').hasColumnType('uuid').isRequired();
            entity.property(reading => reading.region).hasColumnName('region').hasColumnType('text').isRequired();
            entity.property(reading => reading.isActive).hasColumnName('is_active').hasColumnType('boolean').isRequired();
            entity.property(reading => reading.recordedAt).hasColumnName('recorded_at').hasColumnType('timestamptz').isRequired();
            entity.property(reading => reading.payload).hasColumnName('payload').hasColumnType('jsonb').isRequired();
            entity.property(reading => reading.score).hasColumnName('score').hasColumnType('integer').isRequired();
            entity.property(reading => reading.big).hasColumnName('big').hasColumnType('bigint').isRequired();
            entity.property(reading => reading.ratio).hasColumnName('ratio').hasColumnType('double precision');
            entity.property(reading => reading.label).hasColumnName('label').hasColumnType('text');
            // Indexed on a bounded column: MySQL cannot index a TEXT column without a
            // prefix length, which EntityKit does not yet express.
            entity.hasIndex(reading => reading.score).hasDatabaseName('ix_reading_score');
        });
    }
}

const READING_COLUMNS: ReadonlyArray<{ name: string; storeType: string; isNullable: boolean }> = [
    { name: 'id', storeType: 'char(36)', isNullable: false },
    { name: 'region', storeType: 'varchar(255)', isNullable: false },
    { name: 'is_active', storeType: 'tinyint(1)', isNullable: false },
    { name: 'recorded_at', storeType: 'datetime(3)', isNullable: false },
    { name: 'payload', storeType: 'json', isNullable: false },
    { name: 'score', storeType: 'int', isNullable: false },
    { name: 'big', storeType: 'bigint', isNullable: false },
    { name: 'ratio', storeType: 'double', isNullable: true },
    { name: 'label', storeType: 'text', isNullable: true },
];

function columnShape(snapshot: DatabaseSchemaSnapshot, tableName: string): Array<{ name: string; storeType: string; isNullable: boolean; }> | undefined {
    const table = snapshot.schemas.flatMap(schema => schema.tables).find(candidate => candidate.tableName === tableName);
    return table?.columns.map(column => ({ name: column.name, storeType: column.storeType, isNullable: column.isNullable }));
}

// The generated entity file for a table, found by a property it must contain —
// robust to how the generator pascalizes and singularizes the table name.
function entityFileContaining(files: readonly GeneratedCodeFile[], snippet: string): string {
    const file = files.find(candidate => candidate.path.endsWith('.ts') && candidate.contents.includes(snippet));
    if (!file) {
        throw new Error(`No generated file contains ${JSON.stringify(snippet)}. Files: ${files.map(f => f.path).join(', ')}`);
    }
    return file.contents;
}

maybe('MySQL schema introspection', () => {
    let connection: MySqlDatabaseConnection;

    const dropAll = async (): Promise<void> => {
        for (const table of ['ek_pull_sample', 'ek_pull_reading', 'ek_native_child', 'ek_native', 'ek_defaults']) {
            await connection.query({ text: `drop table if exists ${table}`, values: [] });
        }
    };

    beforeEach(async () => {
        connection = new MySqlDatabaseConnection(requireDefined(url));
        await dropAll();
    });

    afterEach(async () => {
        await dropAll();
        await connection.dispose();
    });

    it('round-trips an EntityKit-created schema through db pull without losing or inventing structure', async () => {
        const original =  ReadingDbContext.create();
        try {
            await connection.query({ text: original.database.createScript(), values: [] });
        } finally {
            // Always dispose: a pool left open would keep the event loop alive and
            // hang the runner instead of failing.
            await original.dispose();
        }

        // 1. Introspect the schema EntityKit created.
        const snapshot = await new MySqlSchemaIntrospector(connection).introspect();
        const readingTable = requireDefined(snapshot.schemas.flatMap(schema => schema.tables).find(table => table.tableName === 'ek_pull_reading'));
        expect(readingTable).toBeDefined();
        // The connection's own database reports as an empty schema, so generated
        // tables stay unqualified rather than pinned to this database's name.
        expect(readingTable.schemaName).toBe('');
        expect(columnShape(snapshot, 'ek_pull_reading')).toEqual(READING_COLUMNS);
        expect(readingTable.primaryKey?.columns).toEqual(['id', 'region']);
        expect(readingTable.indexes.map(index => index.name)).toContain('ix_reading_score');

        // 2. Generate model code and confirm it wires MySQL and maps types.
        const contextName = 'PulledReadingContext';
        const { files, diagnostics } = generateDbPullCodeWithDiagnostics(snapshot, { contextName, providerName: 'mysql', connectionStringExpression: JSON.stringify(url) });
        const contextFile = requireDefined(files.find(file =>
            file.path === 'pulled-reading-context.ts',
        )).contents;
        expect(contextFile).toContain('import { mySqlProviderServices } from "entitykit/mysql";');
        expect(contextFile).toContain('options.useProvider(mySqlProviderServices,');
        expect(contextFile).not.toContain('usePostgres');
        expect(contextFile).not.toContain('create schema');
        // The table is unqualified — no database name baked in.
        expect(contextFile).toContain('entity.toTable("ek_pull_reading");');
        const readingFile = entityFileContaining(files, 'isActive!: boolean;');
        expect(readingFile).toContain('recordedAt!: Date;');
        expect(readingFile).toContain('import type { JsonValue } from "entitykit";');
        expect(readingFile).toContain('payload!: JsonValue;');
        expect(readingFile).toContain('score!: number;');
        expect(readingFile).toContain('big!: string;');
        expect(diagnostics.length).toBeGreaterThan(0);

        // 3. Apply the *generated* model's DDL to a clean database.
        const generatedContext = loadGeneratedDbContext(files, contextName, { 'entitykit/mysql': mysqlProvider });
        const pulled = await generatedContext.create();
        try {
            await connection.query({ text: 'drop table if exists ek_pull_reading', values: [] });
            await pulled.database.connection.query({ text: pulled.database.createScript(), values: [] });

            // 4. Prove the generated context reached MySQL (not Postgres) and the
            // regenerated table is writable.
            await pulled.database.connection.query({
                text: 'insert into ek_pull_reading (id, region, is_active, recorded_at, payload, score, big, ratio, label) values (?, ?, 1, ?, ?, 7, 8, 1.5, null)',
                values: ['11111111-1111-1111-1111-111111111111', 'eu-west', new Date('2026-03-04T05:06:07.000Z'), JSON.stringify({ unit: 'c', samples: [1] })],
            });
        } finally {
            await pulled.dispose();
        }

        // 5. Re-introspect the regenerated schema: the store types must be identical
        // to the first pull. Any lossy mapping in codegen would show up here.
        const roundTrip = await new MySqlSchemaIntrospector(connection).introspect();
        expect(columnShape(roundTrip, 'ek_pull_reading')).toEqual(READING_COLUMNS);
    });

    it('introspects a hand-written schema\'s native MySQL types and relationships', async () => {
        await connection.query({
            text: `create table ek_native (
        id char(36) collate utf8mb4_bin not null,
        code varchar(64) collate utf8mb4_bin not null,
        kind enum('alpha','beta','gamma') not null,
        flags set('x','y','z'),
        quantity mediumint,
        counter int unsigned,
        amount decimal(12,4),
        weight float,
        blob_data blob,
        primary key (id, code),
        unique key ux_native_code (code)
      )`,
            values: [],
        });
        await connection.query({
            text: `create table ek_native_child (
        child_id char(36) collate utf8mb4_bin not null,
        parent_id char(36) collate utf8mb4_bin not null,
        parent_code varchar(64) collate utf8mb4_bin not null,
        primary key (child_id),
        constraint fk_native_child foreign key (parent_id, parent_code) references ek_native (id, code) on delete cascade
      )`,
            values: [],
        });

        const snapshot = await new MySqlSchemaIntrospector(connection).introspect();
        const parent = requireDefined(snapshot.schemas.flatMap(schema => schema.tables).find(table => table.tableName === 'ek_native'));
        const child = requireDefined(snapshot.schemas.flatMap(schema => schema.tables).find(table => table.tableName === 'ek_native_child'));

        // The composite foreign key is captured with its columns in order.
        expect(child.foreignKeys).toHaveLength(1);
        expect(child.foreignKeys[0]).toMatchObject({
            columns: ['parent_id', 'parent_code'],
            principalTableName: 'ek_native',
            principalColumns: ['id', 'code'],
            onDelete: 'cascade',
        });
        // MySQL auto-creates an index backing the foreign key, named after the
        // constraint; it must NOT surface as an explicit index or the regenerated
        // model would create it twice.
        expect(child.indexes.map(index => index.name)).not.toContain('fk_native_child');
        expect(child.indexes).toHaveLength(0);
        // The declared unique index is kept; the primary-key index is modeled as the key.
        expect(parent.indexes.map(index => index.name)).toEqual(['ux_native_code']);
        expect(parent.primaryKey?.columns).toEqual(['id', 'code']);

        const { files } = generateDbPullCodeWithDiagnostics(snapshot, { contextName: 'NativeContext', providerName: 'mysql' });
        const nativeFile = entityFileContaining(files, 'kind!:');
        // enum -> string union, mediumint/unsigned int -> number, blob -> Buffer,
        // decimal -> string (needs a converter), set -> string.
        expect(nativeFile).toContain('kind!: "alpha" | "beta" | "gamma";');
        expect(nativeFile).toContain('quantity?: number | null;');
        expect(nativeFile).toContain('counter?: number | null;');
        expect(nativeFile).toContain('amount?: string | null;');
        expect(nativeFile).toContain('weight?: number | null;');
        expect(nativeFile).toContain('blobData?: Buffer | null;');
        expect(nativeFile).toContain('flags?: string | null;');

        // The child's relationship to the composite-key parent is present and keeps
        // the real constraint name (the FK-backing index was filtered at the
        // snapshot level, asserted above, so it is not re-emitted as an index).
        const contextFile = requireDefined(files.find(file => file.path === 'native-context.ts')).contents;
        expect(contextFile).toContain('entity.hasOne(');
        expect(contextFile).toContain('.hasConstraintName("fk_native_child")');
        expect(contextFile).not.toContain('hasIndex(row => row.parentId');
        expect(generateDbPullCode(snapshot, { providerName: 'mysql' }).length).toBe(files.length);
    });

    it('quotes a string default so it round-trips as a literal, not an identifier', async () => {
        await connection.query({
            text: `create table ek_defaults (
        id char(36) collate utf8mb4_bin not null,
        status varchar(20) collate utf8mb4_bin not null default 'active',
        retries int not null default 3,
        created_at datetime(3) not null default current_timestamp(3),
        primary key (id)
      )`,
            values: [],
        });

        const snapshot = await new MySqlSchemaIntrospector(connection).introspect();
        const table = requireDefined(snapshot.schemas.flatMap(schema => schema.tables).find(candidate => candidate.tableName === 'ek_defaults'));
        const defaults = new Map(table.columns.map(column => [column.name, column.defaultSql]));

        // MySQL returns a string literal unquoted; the introspector must quote it so
        // the regenerated `default 'active'` is a literal the server accepts.
        expect(defaults.get('status')).toBe('\'active\'');
        // A numeric literal stays bare, and an expression default is left as-is.
        expect(defaults.get('retries')).toBe('3');
        expect(String(defaults.get('created_at')).toLowerCase()).toContain('current_timestamp');

        // The generated model's schema script re-applies cleanly (the quoted default
        // is valid SQL); prove it by dropping and recreating from the generated DDL.
        const { files } = generateDbPullCodeWithDiagnostics(snapshot, { contextName: 'DefaultsContext', providerName: 'mysql', connectionStringExpression: JSON.stringify(url) });
        const generated = loadGeneratedDbContext(files, 'DefaultsContext', { 'entitykit/mysql': mysqlProvider });
        const pulled = await generated.create();
        try {
            await connection.query({ text: 'drop table if exists ek_defaults', values: [] });
            await pulled.database.connection.query({ text: pulled.database.createScript(), values: [] });
            await pulled.database.connection.query({ text: 'insert into ek_defaults (id) values (\'11111111-1111-1111-1111-111111111111\')', values: [] });
            const row = await connection.query<{ status: string; retries: number }>({ text: 'select status, retries from ek_defaults', values: [] });
            expect(row.rows[0]?.status).toBe('active');
            expect(row.rows[0]?.retries).toBe(3);
        } finally {
            await pulled.dispose();
        }
    });
});
