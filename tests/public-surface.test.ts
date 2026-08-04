import * as entitykit from '../src';
import * as cli from '../src/cli/api';
import * as experimental from '../src/experimental';
import * as migrations from '../src/migrations/api';
import * as postgresSubpath from '../src/providers/postgres';
import * as sqliteSubpath from '../src/providers/sqlite';
import * as mysqlSubpath from '../src/providers/mysql';
import * as testing from '../src/testing';
import * as adapter from '../src/adapter';
import * as tooling from '../src/tooling';

describe('public export surface', () => {
    it('keeps all concrete Postgres vocabulary off the root surface', () => {
        expect('DbContextOptionsBuilder' in entitykit).toBe(false);
        expect(entitykit.DatabaseProviderError).toBeDefined();
        expect('postgres' in entitykit).toBe(false);
        expect('postgresDialect' in entitykit).toBe(false);
        expect('rawSql' in entitykit).toBe(false);
        expect('postgresProviderServices' in entitykit).toBe(false);
        expect('PostgresDatabaseConnection' in entitykit).toBe(false);
        expect('PostgresSchemaIntrospector' in entitykit).toBe(false);
    });

    it('separates custom-provider contracts from schema tooling', () => {
        expect(adapter.buildRawSql).toBeDefined();
        expect(adapter.DatabaseProviderError).toBeDefined();
        expect(tooling.generateDbPullCode).toBeDefined();
        expect(tooling.generateDbPullCodeWithDiagnostics).toBeDefined();
        expect('generateDbPullCode' in entitykit).toBe(false);
        expect('SchemaSqlBuilder' in tooling).toBe(false);
        expect('SchemaSqlBuilder' in adapter).toBe(false);
    });

    it('keeps internal SQL, query, and benchmark building blocks out of the root API', () => {
        for (const internalExport of [
            'SelectSqlBuilder',
            'PredicateSqlCompiler',
            'ModificationSqlBuilder',
            'SchemaSqlBuilder',
            'IncludeLoader',
            'Materializer',
            'createQueryProxy',
            'createJoinedQueryProxy',
            'createJoinedProjectionProxy',
            'validateJoinAlias',
            'createQueryModel',
            'cloneQueryModel',
            'createProjectionBuilder',
            'createProjectionExpression',
            'createProjectionProxy',
            'createAggregateExpressions',
            'createAggregateProxy',
            'createIncludeProxy',
            'createRelationNavigationProxy',
            'quoteIdentifier',
            'SqlParameterBag',
            'formatBenchmarkResults',
            'runBenchmarkCase',
            'runBenchmarkSuite',
        ]) {
            expect(internalExport in entitykit).toBe(false);
        }
    });

    it('keeps internal building blocks available through the experimental entrypoint', () => {
        expect(experimental.SelectSqlBuilder).toBeDefined();
        expect(experimental.PredicateSqlCompiler).toBeDefined();
        expect(experimental.ModificationSqlBuilder).toBeDefined();
        expect(experimental.SchemaSqlBuilder).toBeDefined();
        expect(experimental.IncludeLoader).toBeDefined();
        expect(experimental.Materializer).toBeDefined();
        expect(experimental.createQueryProxy).toBeDefined();
        expect(experimental.createJoinedQueryProxy).toBeDefined();
        expect(experimental.createJoinedProjectionProxy).toBeDefined();
        expect(experimental.validateJoinAlias).toBeDefined();
        expect(experimental.createQueryModel).toBeDefined();
        expect(experimental.cloneQueryModel).toBeDefined();
        expect(experimental.createProjectionBuilder).toBeDefined();
        expect(experimental.createProjectionExpression).toBeDefined();
        expect(experimental.createProjectionProxy).toBeDefined();
        expect(experimental.createAggregateExpressions).toBeDefined();
        expect(experimental.createAggregateProxy).toBeDefined();
        expect(experimental.createIncludeProxy).toBeDefined();
        expect(experimental.createRelationNavigationProxy).toBeDefined();
        expect(experimental.quoteIdentifier).toBeDefined();
        expect(experimental.SqlParameterBag).toBeDefined();
        expect(experimental.runBenchmarkSuite).toBeDefined();
    });

    it('keeps framework-created fluent objects type-only on the root', () => {
        for (const frameworkCreated of [
            'DbSet',
            'EntityBuilder',
            'FieldExpression',
            'HavingPredicateExpression',
            'IncludeNavigationExpression',
            'IndexBuilder',
            'ManyToManyJoinTableBuilder',
            'ManyToManyRelationshipBuilder',
            'PredicateExpression',
            'PropertyBuilder',
            'Queryable',
            'UnsafeRawSqlQueryable',
            'RelationNavigationExpression',
            'RelationshipBuilder',
        ]) {
            expect(frameworkCreated in entitykit).toBe(false);
        }

        expect(experimental.Queryable).toBeDefined();
        expect(experimental.FieldExpression).toBeDefined();
        expect(experimental.PredicateExpression).toBeDefined();
        expect(experimental.UnsafeRawSqlQueryable).toBeDefined();
    });

    it('keeps core-adjacent subpaths free of concrete Postgres adapter exports', () => {
        for (const exported of [migrations, testing]) {
            expect('PostgresDatabaseConnection' in exported).toBe(false);
            expect('PostgresSchemaIntrospector' in exported).toBe(false);
            expect('postgresProviderServices' in exported).toBe(false);
        }
    });

    it('keeps CLI and configuration APIs on the entitykit/cli subpath', () => {
        for (const cliExport of [
            'runEntityKitCli',
            'defineEntityKitConfig',
            'loadEntityKitConfig',
        ]) {
            expect(cliExport in cli).toBe(true);
            expect(cliExport in entitykit).toBe(false);
        }
    });

    it('keeps migration tooling on the entitykit/migrations subpath', () => {
        for (const migrationExport of [
            'Migration',
            'MigrationBuilder',
            'MigrationRunner',
            'MigrationSqlGenerator',
            'diffModelSnapshots',
            'migrationChecksum',
            'postgresMigrationDialect',
            'scaffoldMigration',
            'contextMigrations',
        ]) {
            expect(migrationExport in migrations).toBe(true);
            expect(migrationExport in entitykit).toBe(false);
        }
    });

    it('exposes the concrete Postgres adapter through the entitykit/postgres subpath', () => {
        expect(postgresSubpath.postgresProviderServices).toBeDefined();
        expect(postgresSubpath.PostgresDatabaseConnection).toBeDefined();
        expect(postgresSubpath.PostgresSchemaIntrospector).toBeDefined();
        expect(postgresSubpath.postgres).toBeDefined();
        expect(postgresSubpath.postgresDialect).toBeDefined();
        expect(postgresSubpath.postgresMigrationDialect).toBeDefined();
        expect(postgresSubpath.rawSql).toBeDefined();
    });

    it('exposes the SQLite adapter through the entitykit/sqlite subpath', () => {
        expect(sqliteSubpath.sqliteProviderServices).toBeDefined();
        expect(sqliteSubpath.SqliteDatabaseConnection).toBeDefined();
        expect(sqliteSubpath.SqliteSchemaIntrospector).toBeDefined();
        expect(sqliteSubpath.sqliteDialect).toBeDefined();
        expect(sqliteSubpath.sqliteMigrationDialect).toBeDefined();
        expect(sqliteSubpath.rawSql).toBeDefined();
        // core stays provider-neutral: the SQLite adapter is not on the root
        expect('sqliteProviderServices' in entitykit).toBe(false);
        expect('SqliteDatabaseConnection' in entitykit).toBe(false);
    });

    it('exposes the MySQL adapter through the entitykit/mysql subpath', () => {
        expect(mysqlSubpath.mySqlProviderServices).toBeDefined();
        expect(mysqlSubpath.MySqlDatabaseConnection).toBeDefined();
        expect(mysqlSubpath.MySqlSchemaIntrospector).toBeDefined();
        expect(typeof mysqlSubpath.mySqlProviderServices.createSchemaIntrospector).toBe('function');
        expect(mysqlSubpath.mySqlDialect).toBeDefined();
        expect(mysqlSubpath.mySqlMigrationDialect).toBeDefined();
        expect(mysqlSubpath.rawSql).toBeDefined();
        // core stays provider-neutral: the MySQL adapter is not on the root
        expect('mySqlProviderServices' in entitykit).toBe(false);
        expect('MySqlDatabaseConnection' in entitykit).toBe(false);
    });

    it('pins the migrations subpath to migration APIs and dialect compatibility', () => {
        expect(Object.keys(migrations).sort()).toEqual([
            'EntityKitError',
            'Migration',
            'MigrationBuilder',
            'MigrationChecksumError',
            'MigrationDataLossError',
            'MigrationError',
            'MigrationExecutionError',
            'MigrationLockReleaseError',
            'MigrationRunner',
            'MigrationSqlGenerator',
            'PendingModelChangesError',
            'addMigration',
            'collectDestructiveWarnings',
            'contextMigrations',
            'diffModelSnapshots',
            'discoverMigrations',
            'formatMigrationTimestamp',
            'hasPendingModelChanges',
            'listMigrations',
            'loadMigrationFile',
            'migrationChecksum',
            'postgresMigrationDialect',
            'readModelSnapshot',
            'removeLatestMigration',
            'renderScript',
            'renderSnapshotSource',
            'scaffoldMigration',
            'selectMigrationRange',
            'writeMigrationScaffold',
        ]);
        expect(migrations.postgresMigrationDialect).toBe(postgresSubpath.postgresMigrationDialect);
        expect(new migrations.MigrationError('failed'))
            .toBeInstanceOf(entitykit.EntityKitError);
        for (const migrationError of [
            'MigrationError',
            'MigrationChecksumError',
            'MigrationDataLossError',
            'MigrationExecutionError',
            'MigrationLockReleaseError',
            'PendingModelChangesError',
        ]) {
            expect(migrationError in entitykit).toBe(false);
        }
    });

    it('pins the testing subpath to provider-neutral test doubles', () => {
        expect(Object.keys(testing).sort()).toEqual(['RecordingDatabaseConnection']);
    });

    it('exposes the maintained recording connection through the testing subpath', () => {
        const connection = new testing.RecordingDatabaseConnection();

        expect(connection.operations).toEqual([]);
        expect(typeof connection.failNextTransactionCommit).toBe('function');
    });

    it('keeps example applications out of the root API', () => {
        expect('AppDbContext' in entitykit).toBe(false);
        expect('BlogSaasDbContext' in entitykit).toBe(false);
        expect('CrudAppDbContext' in entitykit).toBe(false);
    });

});
