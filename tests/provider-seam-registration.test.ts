import path from 'node:path';
import {
    listSourceFiles,
    readSource,
} from './support/provider-seam-test-support';

describe('provider seam architecture: registration', () => {
    it('routes the built-in Postgres provider through a lazy core loader', () => {
        const loader = readSource('src/core/built-in-postgres.ts');

        expect(loader).toContain('\'../providers/postgres/postgres-provider-services\'');
        expect(loader).toContain('\'entitykit/postgres\'');
        expect(loader).not.toMatch(/import[^\n]*from\s+["'][^"']*providers\/postgres/);

        expect(readSource('src/core/context-options/db-context-options-builder.ts'))
            .toContain('loadBuiltInPostgresProviderServices');
        const cliConfig = readSource('src/cli/entity-kit-config.ts');
        expect(cliConfig).not.toContain('loadBuiltInPostgresProviderServices');
        expect(cliConfig).not.toMatch(/providers\/postgres|from ['"]pg['"]/);
    });

    it('routes the built-in SQLite provider through a lazy core loader', () => {
        const loader = readSource('src/core/built-in-sqlite.ts');

        expect(loader).toContain('\'../providers/sqlite/sqlite-provider-services\'');
        expect(loader).toContain('\'entitykit/sqlite\'');
        expect(loader).not.toMatch(/import[^\n]*from\s+["'][^"']*providers\/sqlite/);
        expect(readSource('src/core/context-options/db-context-options-builder.ts'))
            .toContain('loadBuiltInSqliteProviderServices');
    });

    it('routes the built-in MySQL provider through a lazy core loader', () => {
        const loader = readSource('src/core/built-in-mysql.ts');

        expect(loader).toContain('\'../providers/mysql/mysql-provider-services\'');
        expect(loader).toContain('\'entitykit/mysql\'');
        expect(loader).not.toMatch(/import[^\n]*from\s+["'][^"']*providers\/mysql/);
        expect(readSource('src/core/context-options/db-context-options-builder.ts'))
            .toContain('loadBuiltInMysqlProviderServices');

        // The MySQL adapter stays off core's and cli's static import graph everywhere
        // but that lazy bridge, so `require("entitykit")` never loads `mysql2`.
        const guarded = [...listSourceFiles('src/core'), ...listSourceFiles('src/cli')]
            .filter(file => file !== 'src/core/built-in-mysql.ts');
        for (const file of guarded) {
            expect(readSource(file)).not.toMatch(/import[^\n]*from\s+["'][^"']*providers\/mysql/);
        }
    });

    it('exposes the concrete Postgres adapter through the entitykit/postgres barrel', () => {
        const barrel = readSource('src/providers/postgres/index.ts');

        expect(barrel).toContain('postgresProviderServices');
        expect(barrel).toContain('PostgresDatabaseConnection');
        expect(barrel).toContain('PostgresSchemaIntrospector');
        expect(barrel).toContain('postgres');
        expect(barrel).toContain('postgresDialect');
    });

    it('keeps generic storage and introspection folders free of concrete Postgres implementations', () => {
        expect(listSourceFiles('src/storage').filter(file => /Postgres|Pg/.test(path.basename(file)))).toEqual([]);
        expect(listSourceFiles('src/introspection').filter(file => /Postgres|Pg/.test(path.basename(file)))).toEqual([]);
        expect(listSourceFiles('src/providers/postgres').sort()).toEqual([
            'src/providers/postgres/index.ts',
            'src/providers/postgres/pg-database-connection.ts',
            'src/providers/postgres/postgres-buffered-query.ts',
            'src/providers/postgres/postgres-column-generation.ts',
            'src/providers/postgres/postgres-commit-outcome.ts',
            'src/providers/postgres/postgres-connection-source.ts',
            'src/providers/postgres/postgres-data-source.ts',
            'src/providers/postgres/postgres-driver-contract.ts',
            'src/providers/postgres/postgres-driver.ts',
            'src/providers/postgres/postgres-introspect-index-query.ts',
            'src/providers/postgres/postgres-introspect-queries.ts',
            'src/providers/postgres/postgres-introspect-schema-queries.ts',
            'src/providers/postgres/postgres-introspection-values.ts',
            'src/providers/postgres/postgres-pool-errors.ts',
            'src/providers/postgres/postgres-pooled-connection.ts',
            'src/providers/postgres/postgres-pooled-savepoint.ts',
            'src/providers/postgres/postgres-provider-error.ts',
            'src/providers/postgres/postgres-provider-services.ts',
            'src/providers/postgres/postgres-query-helpers.ts',
            'src/providers/postgres/postgres-row-stream.ts',
            'src/providers/postgres/postgres-schema-facets.ts',
            'src/providers/postgres/postgres-schema-introspector.ts',
            'src/providers/postgres/postgres-schema-snapshot-types.ts',
            'src/providers/postgres/postgres-schema-snapshot.ts',
            'src/providers/postgres/postgres-stream-lease.ts',
            'src/providers/postgres/postgres-transaction.ts',
        ]);
    });

    it('keeps db pull schema snapshot types provider-neutral', () => {
        const providerServices = readSource('src/storage/database-provider-services.ts');
        const dbPullCodegen = readSource('src/introspection/db-pull-code-generator.ts');

        expect(providerServices).toContain('../introspection/database-schema');
        expect(dbPullCodegen).toContain('./database-schema');
        expect(providerServices).not.toContain('PostgresSchemaIntrospector');
        expect(dbPullCodegen).not.toContain('PostgresSchemaIntrospector');
    });
});
