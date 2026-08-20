import { requireDefined } from '../support/require-defined';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generateDbPullCodeWithDiagnostics } from '../../packages/core/src/introspection/db-pull-code-generator';
import type { DatabaseTable } from '../../packages/core/src/introspection/database-schema';
import { postgresProviderServices } from '../../packages/postgres/src';
import type { PostgresDatabaseConnection } from '../../packages/postgres/src/pg-database-connection';
import { createManagedTempDirectory } from '../support/managed-temp-directory';

const shouldRun = process.env.RUN_POSTGRES_TESTS === 'true' && Boolean(process.env.DATABASE_URL);
const maybe = shouldRun ? describe : describe.skip;

/**
 * A schema built to be awkward on purpose. Every item is something a real
 * database somewhere actually contains, and each one is a way `db pull` could
 * quietly produce code that does not compile — which is the thing this file
 * exists to prevent.
 */
const HOSTILE = [
    'drop schema if exists hostile cascade',
    'create schema hostile',

    // Reserved words as identifiers.
    'create table hostile."order" ("select" text primary key, "from" text not null, "group" integer)',

    // Mixed case, which Postgres preserves only because it is quoted.
    'create table hostile."MixedCase" ("Id" text primary key, "userName" text not null, "CreatedAt" timestamptz)',

    // Names that collide once normalized to a class or property name.
    'create table hostile.user_profile (id text primary key, first_name text, "firstName" text)',

    // No primary key at all.
    'create table hostile.no_key (a text not null, b integer)',

    // Composite primary key.
    'create table hostile.composite (tenant_id text not null, code text not null, label text, primary key (tenant_id, code))',

    // Self-referencing foreign key.
    'create table hostile.node (id text primary key, parent_id text references hostile.node (id))',

    // Circular foreign keys between two tables.
    'create table hostile.chicken (id text primary key, egg_id text)',
    'create table hostile.egg (id text primary key, chicken_id text references hostile.chicken (id))',
    'alter table hostile.chicken add constraint chicken_egg_fk foreign key (egg_id) references hostile.egg (id)',

    // Types EntityKit has no obvious mapping for.
    'create table hostile.exotic (id text primary key, location point, span int4range, addr inet, money_col money, bits bit(8))',

    // An identifier at Postgres's 63-character limit.
    'create table hostile.a_table_name_that_is_absolutely_enormous_and_goes_right_up_to_63 (id text primary key)',

    // A name that is not a valid JavaScript identifier.
    'create table hostile."weird-name with spaces" (id text primary key, "col-with-dash" text)',
];

maybe('db pull against a hostile schema', () => {
    let connection: PostgresDatabaseConnection;
    let result: ReturnType<typeof generateDbPullCodeWithDiagnostics>;
    let tables: readonly DatabaseTable[] = [];

    beforeAll(async () => {
        const { PostgresDatabaseConnection } = await import('../../packages/postgres/src/pg-database-connection');
        connection = new PostgresDatabaseConnection(requireDefined(process.env.DATABASE_URL));
        for (const statement of HOSTILE) {
            await connection.query({ text: statement, values: [] });
        }

        const introspector = requireDefined(
            postgresProviderServices.createSchemaIntrospector?.(connection),
        );
        const snapshot = await introspector.introspect({ schemas: ['hostile'] });
        tables = snapshot.schemas.flatMap(schema => schema.tables);
        result = generateDbPullCodeWithDiagnostics(snapshot, { contextName: 'HostileDbContext' });
    }, 120000);

    afterAll(async () => {
        await connection.query({ text: 'drop schema if exists hostile cascade', values: [] });
        await connection.dispose();
    });

    const tableNamed = (name: string): DatabaseTable =>
        requireDefined(tables.find(table => table.tableName === name));

    it('generates TypeScript that compiles', () => {
    // The check that matters. `db pull` producing code a person then has to
    // repair by hand is barely better than not producing it: a self-referencing
    // foreign key emitted `import { Node } from "./node"` *inside* `node.ts`,
    // which TypeScript rejects outright.
        const dir = createManagedTempDirectory('ek-pull-hostile-');
        try {
            for (const file of result.files) {
                writeFileSync(join(dir, file.path.replace(/[\\/]/g, '_')), file.contents, 'utf8');
            }
            writeFileSync(join(dir, 'tsconfig.json'), JSON.stringify({
                compilerOptions: {
                    strict: true, noEmit: true, target: 'ES2022', module: 'esnext',
                    moduleResolution: 'bundler', skipLibCheck: true,
                    baseUrl: process.cwd(),
                    typeRoots: [join(process.cwd(), 'node_modules', '@types')],
                    paths: { '@entitykit/core': ['packages/core/src/index.ts'], '@entitykit/core/*': ['packages/core/src/*'] },
                    types: ['node'],
                },
                include: [join(dir, '*.ts')],
            }, null, 2));

            const check = spawnSync(join(process.cwd(), 'node_modules', '.bin', 'tsc'), ['-p', join(dir, 'tsconfig.json')], { encoding: 'utf8' });
            // Errors inside EntityKit's own sources are not this test's business.
            const errors = (check.stdout || '').split('\n').filter(line => line.includes('error TS') && !/(^|[\\/])src[\\/]/.test(line));

            expect(errors).toEqual([]);
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }, 180000);

    it('emits no import of a file into itself', () => {
        for (const file of result.files) {
            const className = file.path.replace(/\.ts$/, '');
            expect(file.contents).not.toContain(`import { ${className} } from "./${className}"`);
        }
    });

    describe('introspects what is there', () => {
        it('reads reserved words as identifiers', () => {
            const table = tableNamed('order');
            expect(table.columns.map(column => column.name).sort()).toEqual(['from', 'group', 'select']);
            expect(requireDefined(table.primaryKey).columns).toEqual(['select']);
        });

        it('preserves quoted mixed-case names', () => {
            const table = tableNamed('MixedCase');
            expect(table.columns.map(column => column.name)).toContain('userName');
        });

        it('reads a composite primary key as a tuple', () => {
            expect(requireDefined(tableNamed('composite').primaryKey).columns).toEqual(['tenant_id', 'code']);
        });

        it('reads a self-referencing foreign key', () => {
            const table = tableNamed('node');
            expect(table.foreignKeys).toHaveLength(1);
            expect(requireDefined(table.foreignKeys[0]).principalTableName).toBe('node');
        });

        it('reads foreign keys that form a cycle', () => {
            expect(requireDefined(tableNamed('chicken').foreignKeys[0]).principalTableName).toBe('egg');
            expect(requireDefined(tableNamed('egg').foreignKeys[0]).principalTableName).toBe('chicken');
        });

        it('reads a table with no primary key rather than skipping it', () => {
            const table = tableNamed('no_key');
            expect(table).toBeDefined();
            expect(table.primaryKey).toBeUndefined();
        });

        it('reads a name that is not a valid identifier', () => {
            expect(tableNamed('weird-name with spaces')).toBeDefined();
        });
    });

    describe('says what it could not do', () => {
        it('warns for every column type it cannot map', () => {
            const unmapped = result.diagnostics.filter(d => d.category === 'column' && d.message.includes('generated TypeScript type is \'unknown\''));

            expect(unmapped.map(d => /"(\w+)"\.$|\."(\w+)" uses/.exec(d.message)?.[2]).filter(Boolean).sort())
                .toEqual(['addr', 'bits', 'location', 'money_col', 'span']);
        });

        it('warns that a keyless table got an invented key', () => {
            const warning = result.diagnostics.find(d => d.category === 'table' && d.message.includes('no primary key'));

            expect(warning).toBeDefined();
            expect(requireDefined(warning).message).toContain('no_key');
        });
    });
});
