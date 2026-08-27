import {
    coreNeutralSourceRoots,
    filesContaining,
    listSourceFiles,
    readSource,
} from './support/provider-seam-test-support';

describe('provider seam architecture: imports', () => {
    it('keeps core options from importing the Postgres adapter and loads it lazily', () => {
        const source = readSource('packages/core/src/core/context-options/db-context-options-builder.ts');

        expect(source).not.toContain('PostgresDatabaseConnection');
        expect(source).not.toMatch(/from\s+["']pg["']/);
        expect(source).not.toMatch(/import[^\n]*from\s+["'][^"']*(?:packages\/postgres\/src|@entitykit\/postgres)/);
        expect(source).toContain('useProvider(');
        expect(source).toContain('loadBuiltInPostgresProviderServices');
    });

    it('keeps core-neutral source roots free of concrete Postgres adapter imports', () => {
        const files = coreNeutralSourceRoots.flatMap(root => listSourceFiles(root));

        for (const file of files) {
            const source = readSource(file);

            expect(source).not.toMatch(/from\s+["'][^"']*(?:packages\/postgres\/src|@entitykit\/postgres)/);
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
        const futureTestingPackage = readSource('tests/fixtures/adapter-split-dry-run/future-testing-package.ts');
        const futurePostgresPackage = readSource('tests/fixtures/adapter-split-dry-run/future-postgres-adapter-package.ts');
        const futurePostgresConsumer = readSource('tests/fixtures/adapter-split-dry-run/future-postgres-consumer.ts');

        expect(coreFixture).toContain('DatabaseProviderServices');
        expect(coreFixture).not.toMatch(/Postgres|PostgresDatabaseConnection|postgresProviderServices|usePostgres/);
        expect(postgresFixture).toContain('PostgresDatabaseConnection');
        expect(postgresFixture).toContain('PostgresSchemaIntrospector');
        expect(postgresFixture).toContain('postgresProviderServices');
        expect(futureCorePackage).toContain('DatabaseProviderServices');
        expect(futureCorePackage).not.toMatch(/Postgres|PostgresDatabaseConnection|postgresProviderServices|usePostgres|packages\/postgres/);
        expect(futureCoreConsumer).not.toMatch(/Postgres|PostgresDatabaseConnection|postgresProviderServices|usePostgres|packages\/postgres/);
        expect(futurePostgresPackage).toMatch(/packages\/postgres\/src/);
        expect(futurePostgresConsumer).toContain('useProvider');
        // The recording test doubles are their own package, so the core stand-in
        // must not re-export them and the consumer must name them separately.
        expect(futureCorePackage).not.toMatch(/packages\/testing\/src|RecordingDatabaseConnection/);
        expect(futureTestingPackage).toMatch(/packages\/testing\/src/);
        expect(futureTestingPackage).toContain('RecordingDatabaseConnection');
        expect(futureCoreConsumer).toMatch(/from '\.\/future-testing-package'/);
    });

    it('keeps generic provider services free of concrete Postgres services', () => {
        const source = readSource('packages/core/src/storage/database-provider-services.ts');

        expect(source).not.toContain('PostgresDatabaseConnection');
        expect(source).not.toContain('PostgresSchemaIntrospector');
        expect(source).not.toContain('postgresProviderServices');
        expect(source).not.toMatch(/from\s+["']pg["']/);
        expect(source).toContain('createMigrationBuilder');
    });

    it('keeps core query and migration paths from importing concrete Postgres storage', () => {
        const files = [
            ...listSourceFiles('packages/core/src/core'),
            ...listSourceFiles('packages/core/src/query'),
            ...listSourceFiles('packages/core/src/sql'),
            ...listSourceFiles('packages/core/src/migrations'),
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
        expect(filesContaining(/require\(["']pg["']\)/)).toEqual([
            'packages/postgres/src/postgres-driver.ts',
        ]);
    });

    it('keeps mysql2 loading isolated to the MySQL driver boundary', () => {
        expect(filesContaining(/from\s+["']mysql2(?:\/promise)?["']/)).toEqual([]);
        expect(filesContaining(/require\(["']mysql2\/promise["']\)/)).toEqual([
            'packages/mysql/src/mysql-driver.ts',
        ]);
    });

    it('keeps direct node:sqlite imports isolated to the SQLite connection implementation', () => {
        expect(filesContaining(/from\s+["']node:sqlite["']/)).toEqual([
            'packages/sqlite/src/sqlite-buffered-query.ts',
            'packages/sqlite/src/sqlite-database-connection.ts',
            'packages/sqlite/src/sqlite-statement.ts',
        ]);
    });

    it('keeps the SQLite adapter out of core, cli, and core-neutral source roots', () => {
        const files = [
            ...listSourceFiles('packages/core/src/core'),
            ...listSourceFiles('packages/cli/src'),
            ...coreNeutralSourceRoots.flatMap(root => listSourceFiles(root)),
        ].filter(file => file !== 'packages/core/src/core/built-in-sqlite.ts');

        for (const file of files) {
            const source = readSource(file);

            expect(source).not.toMatch(/from\s+["'][^"']*(?:packages\/sqlite\/src|@entitykit\/sqlite)/);
            expect(source).not.toContain('SqliteDatabaseConnection');
            expect(source).not.toContain('sqliteProviderServices');
        }
    });

    it('keeps concrete Postgres service ownership in the adapter, barrels, and the lazy core bridge', () => {
        const concreteOwnerFiles = filesContaining(/PostgresDatabaseConnection|PostgresSchemaIntrospector|postgresProviderServices/);

        // `packages/core/src/experimental/index.ts` is deliberately absent: the
        // entry belongs to core and must not name a provider's concrete
        // services, or core would depend on the Postgres package after the split.
        expect(concreteOwnerFiles).toEqual([
            'packages/core/src/core/built-in-postgres.ts',
            'packages/postgres/src/index.ts',
            'packages/postgres/src/pg-database-connection.ts',
            'packages/postgres/src/postgres-data-source.ts',
            'packages/postgres/src/postgres-provider-services.ts',
            'packages/postgres/src/postgres-schema-introspector.ts',
        ]);
    });

    it('keeps core and cli free of static Postgres adapter imports (package-split ready)', () => {
        const files = [...listSourceFiles('packages/core/src/core'), ...listSourceFiles('packages/cli/src')];

        for (const file of files) {
            const source = readSource(file);

            expect(source).not.toMatch(/import[^\n]*from\s+["'][^"']*(?:packages\/postgres\/src|@entitykit\/postgres)/);
            expect(source).not.toMatch(/from\s+["']pg["']/);
        }
    });
});
