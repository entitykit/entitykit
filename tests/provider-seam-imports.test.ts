import {
    coreNeutralSourceRoots,
    filesContaining,
    listSourceFiles,
    readSource,
} from './support/provider-seam-test-support';

describe('provider seam architecture: imports', () => {
    it('keeps core options from importing the Postgres adapter and loads it lazily', () => {
        const source = readSource('src/core/context-options/db-context-options-builder.ts');

        expect(source).not.toContain('PostgresDatabaseConnection');
        expect(source).not.toMatch(/from\s+["']pg["']/);
        expect(source).not.toMatch(/import[^\n]*from\s+["'][^"']*providers\/postgres/);
        expect(source).toContain('useProvider(');
        expect(source).toContain('loadBuiltInPostgresProviderServices');
    });

    it('keeps core-neutral source roots free of concrete Postgres adapter imports', () => {
        const files = coreNeutralSourceRoots.flatMap(root => listSourceFiles(root));

        for (const file of files) {
            const source = readSource(file);

            expect(source).not.toMatch(/from\s+["'][^"']*providers\/postgres/);
            expect(source).not.toContain('PostgresDatabaseConnection');
            expect(source).not.toContain('PostgresSchemaIntrospector');
            expect(source).not.toContain('postgresProviderServices');
        }
    });

    it('keeps adapter-boundary fixture ownership explicit', () => {
        const coreFixture = readSource('tests/fixtures/adapter-boundary/core-consumer.ts');
        const postgresFixture = readSource('tests/fixtures/adapter-boundary/postgres-consumer.ts');
        const futureCorePackage = readSource('tests/fixtures/adapter-split-dry-run/future-core-package.ts');
        const futureCoreConsumer = readSource('tests/fixtures/adapter-split-dry-run/future-core-consumer.ts');
        const futurePostgresPackage = readSource('tests/fixtures/adapter-split-dry-run/future-postgres-adapter-package.ts');
        const futurePostgresConsumer = readSource('tests/fixtures/adapter-split-dry-run/future-postgres-consumer.ts');

        expect(coreFixture).toContain('DatabaseProviderServices');
        expect(coreFixture).not.toMatch(/Postgres|PostgresDatabaseConnection|postgresProviderServices|usePostgres/);
        expect(postgresFixture).toContain('PostgresDatabaseConnection');
        expect(postgresFixture).toContain('PostgresSchemaIntrospector');
        expect(postgresFixture).toContain('postgresProviderServices');
        expect(futureCorePackage).toContain('DatabaseProviderServices');
        expect(futureCorePackage).not.toMatch(/Postgres|PostgresDatabaseConnection|postgresProviderServices|usePostgres|providers\/postgres/);
        expect(futureCoreConsumer).not.toMatch(/Postgres|PostgresDatabaseConnection|postgresProviderServices|usePostgres|providers\/postgres/);
        expect(futurePostgresPackage).toMatch(/providers\/postgres/);
        expect(futurePostgresConsumer).toContain('useProvider');
    });

    it('keeps generic provider services free of concrete Postgres services', () => {
        const source = readSource('src/storage/database-provider-services.ts');

        expect(source).not.toContain('PostgresDatabaseConnection');
        expect(source).not.toContain('PostgresSchemaIntrospector');
        expect(source).not.toContain('postgresProviderServices');
        expect(source).not.toMatch(/from\s+["']pg["']/);
        expect(source).toContain('createMigrationBuilder');
    });

    it('keeps core query and migration paths from importing concrete Postgres storage', () => {
        const files = [
            ...listSourceFiles('src/core'),
            ...listSourceFiles('src/query'),
            ...listSourceFiles('src/sql'),
            ...listSourceFiles('src/migrations'),
        ];

        for (const file of files) {
            const source = readSource(file);

            expect(source).not.toContain('PostgresDatabaseConnection');
            expect(source).not.toContain('PostgresSchemaIntrospector');
            expect(source).not.toMatch(/from\s+["']pg["']/);
        }
    });

    it('keeps pg loading isolated to the Postgres driver boundary', () => {
        expect(filesContaining(/from\s+["']pg["']/)).toEqual([]);
        expect(filesContaining(/loadModule\(["']pg["']\)/)).toEqual([
            'src/providers/postgres/postgres-driver.ts',
        ]);
    });

    it('keeps direct node:sqlite imports isolated to the SQLite connection implementation', () => {
        expect(filesContaining(/from\s+["']node:sqlite["']/)).toEqual([
            'src/providers/sqlite/sqlite-buffered-query.ts',
            'src/providers/sqlite/sqlite-database-connection.ts',
            'src/providers/sqlite/sqlite-statement.ts',
        ]);
    });

    it('keeps the SQLite adapter out of core, cli, and core-neutral source roots', () => {
        const files = [
            ...listSourceFiles('src/core'),
            ...listSourceFiles('src/cli'),
            ...coreNeutralSourceRoots.flatMap(root => listSourceFiles(root)),
        ].filter(file => file !== 'src/core/built-in-sqlite.ts');

        for (const file of files) {
            const source = readSource(file);

            expect(source).not.toMatch(/from\s+["'][^"']*providers\/sqlite/);
            expect(source).not.toContain('SqliteDatabaseConnection');
            expect(source).not.toContain('sqliteProviderServices');
        }
    });

    it('keeps concrete Postgres service ownership in the adapter, barrels, and the lazy core bridge', () => {
        const concreteOwnerFiles = filesContaining(/PostgresDatabaseConnection|PostgresSchemaIntrospector|postgresProviderServices/);

        expect(concreteOwnerFiles).toEqual([
            'src/core/built-in-postgres.ts',
            'src/experimental/index.ts',
            'src/providers/postgres/index.ts',
            'src/providers/postgres/pg-database-connection.ts',
            'src/providers/postgres/postgres-data-source.ts',
            'src/providers/postgres/postgres-provider-services.ts',
            'src/providers/postgres/postgres-schema-introspector.ts',
        ]);
    });

    it('keeps core and cli free of static Postgres adapter imports (package-split ready)', () => {
        const files = [...listSourceFiles('src/core'), ...listSourceFiles('src/cli')];

        for (const file of files) {
            const source = readSource(file);

            expect(source).not.toMatch(/import[^\n]*from\s+["'][^"']*providers\/postgres/);
            expect(source).not.toMatch(/from\s+["']pg["']/);
        }
    });
});
