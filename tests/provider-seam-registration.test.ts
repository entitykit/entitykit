import path from 'node:path';
import {
    listSourceFiles,
    readSource,
} from './support/provider-seam-test-support';

describe('provider seam architecture: registration', () => {
    it('routes the built-in Postgres provider through a lazy core loader', () => {
        const loader = readSource('packages/core/src/core/built-in-postgres.ts');

        expect(loader).toContain('\'../../../postgres/src/postgres-provider-services\'');
        expect(loader).toContain('\'@entitykit/postgres\'');
        expect(loader).not.toMatch(/import[^\n]*from\s+["'][^"']*(?:packages\/postgres\/src|@entitykit\/postgres)/);

        expect(readSource('packages/core/src/core/context-options/db-context-options-builder.ts'))
            .toContain('loadBuiltInPostgresProviderServices');
        const cliConfig = readSource('packages/cli/src/entity-kit-config.ts');
        expect(cliConfig).not.toContain('loadBuiltInPostgresProviderServices');
        expect(cliConfig).not.toMatch(/packages\/postgres|@entitykit\/postgres|from ['"]pg['"]/);
    });

    it('routes the built-in SQLite provider through a lazy core loader', () => {
        const loader = readSource('packages/core/src/core/built-in-sqlite.ts');

        expect(loader).toContain('\'../../../sqlite/src/sqlite-provider-services\'');
        expect(loader).toContain('\'@entitykit/sqlite\'');
        expect(loader).not.toMatch(/import[^\n]*from\s+["'][^"']*(?:packages\/sqlite\/src|@entitykit\/sqlite)/);
        expect(readSource('packages/core/src/core/context-options/db-context-options-builder.ts'))
            .toContain('loadBuiltInSqliteProviderServices');
    });

    it('routes the built-in MySQL provider through a lazy core loader', () => {
        const loader = readSource('packages/core/src/core/built-in-mysql.ts');

        expect(loader).toContain('\'../../../mysql/src/mysql-provider-services\'');
        expect(loader).toContain('\'@entitykit/mysql\'');
        expect(loader).not.toMatch(/import[^\n]*from\s+["'][^"']*(?:packages\/mysql\/src|@entitykit\/mysql)/);
        expect(readSource('packages/core/src/core/context-options/db-context-options-builder.ts'))
            .toContain('loadBuiltInMysqlProviderServices');

        // The MySQL adapter stays off core's and cli's static import graph everywhere
        // but that lazy bridge, so `require("@entitykit/core")` never loads `mysql2`.
        const guarded = [...listSourceFiles('packages/core/src/core'), ...listSourceFiles('packages/cli/src')]
            .filter(file => file !== 'packages/core/src/core/built-in-mysql.ts');
        for (const file of guarded) {
            expect(readSource(file)).not.toMatch(/import[^\n]*from\s+["'][^"']*(?:packages\/mysql\/src|@entitykit\/mysql)/);
        }
    });

    it('exposes the concrete Postgres adapter through the @entitykit/postgres barrel', () => {
        const barrel = readSource('packages/postgres/src/index.ts');

        expect(barrel).toContain('postgresProviderServices');
        expect(barrel).toContain('PostgresDatabaseConnection');
        expect(barrel).toContain('PostgresSchemaIntrospector');
        expect(barrel).toContain('postgres');
        expect(barrel).toContain('postgresDialect');
    });

    it('keeps generic storage and introspection folders free of concrete Postgres implementations', () => {
        expect(listSourceFiles('packages/core/src/storage').filter(file => /Postgres|Pg/.test(path.basename(file)))).toEqual([]);
        expect(listSourceFiles('packages/core/src/introspection').filter(file => /Postgres|Pg/.test(path.basename(file)))).toEqual([]);
        expect(listSourceFiles('packages/postgres/src').sort()).toEqual([
            'packages/postgres/src/index.ts',
            'packages/postgres/src/pg-database-connection.ts',
            'packages/postgres/src/postgres-buffered-query.ts',
            'packages/postgres/src/postgres-column-generation.ts',
            'packages/postgres/src/postgres-commit-outcome.ts',
            'packages/postgres/src/postgres-connection-source.ts',
            'packages/postgres/src/postgres-data-source.ts',
            'packages/postgres/src/postgres-driver-contract.ts',
            'packages/postgres/src/postgres-driver.ts',
            'packages/postgres/src/postgres-introspect-index-query.ts',
            'packages/postgres/src/postgres-introspect-queries.ts',
            'packages/postgres/src/postgres-introspect-schema-queries.ts',
            'packages/postgres/src/postgres-introspection-values.ts',
            'packages/postgres/src/postgres-pool-errors.ts',
            'packages/postgres/src/postgres-pooled-connection.ts',
            'packages/postgres/src/postgres-pooled-savepoint.ts',
            'packages/postgres/src/postgres-provider-error.ts',
            'packages/postgres/src/postgres-provider-services.ts',
            'packages/postgres/src/postgres-query-helpers.ts',
            'packages/postgres/src/postgres-row-stream.ts',
            'packages/postgres/src/postgres-schema-facets.ts',
            'packages/postgres/src/postgres-schema-introspector.ts',
            'packages/postgres/src/postgres-schema-snapshot-types.ts',
            'packages/postgres/src/postgres-schema-snapshot.ts',
            'packages/postgres/src/postgres-stream-lease.ts',
            'packages/postgres/src/postgres-transaction.ts',
        ]);
    });

    it('keeps db pull schema snapshot types provider-neutral', () => {
        const providerServices = readSource('packages/core/src/storage/database-provider-services.ts');
        const dbPullCodegen = readSource('packages/core/src/introspection/db-pull-code-generator.ts');

        expect(providerServices).toContain('../introspection/database-schema');
        expect(dbPullCodegen).toContain('./database-schema');
        expect(providerServices).not.toContain('PostgresSchemaIntrospector');
        expect(dbPullCodegen).not.toContain('PostgresSchemaIntrospector');
    });
});
