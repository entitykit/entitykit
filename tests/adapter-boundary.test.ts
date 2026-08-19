import fs from 'fs';
import path from 'path';
import { createCoreOnlyBoundaryContext, createCoreOnlyMigration } from './fixtures/adapter-boundary/core-consumer';
import {
    createBuiltInPostgresConnection,
    createBuiltInPostgresIntrospector,
    createBuiltInPostgresOptions,
} from './fixtures/adapter-boundary/postgres-consumer';
import {
    createFutureCoreContext,
    createFutureCoreMigration,
    createFutureCoreProvider,
} from './fixtures/adapter-split-dry-run/future-core-consumer';
import {
    createFuturePostgresConnection,
    createFuturePostgresIntrospector,
    createFuturePostgresOptions,
    createFuturePostgresProvider,
} from './fixtures/adapter-split-dry-run/future-postgres-consumer';
import { RecordingDatabaseConnection as FutureTestingRecordingConnection } from './fixtures/adapter-split-dry-run/future-testing-package';

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath: string): string {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('provider adapter package boundary rehearsal', () => {
    it('typechecks a core-only consumer without concrete Postgres adapter imports', () => {
        const source = read('tests/fixtures/adapter-boundary/core-consumer.ts');

        expect(createCoreOnlyBoundaryContext).toBeDefined();
        expect(createCoreOnlyMigration().id).toBe('20260601170000_AdapterBoundary');
        expect(source).toContain('DatabaseProviderServices');
        expect(source).toContain('RecordingDatabaseConnection');
        expect(source).not.toMatch(/Postgres|PostgresDatabaseConnection|postgresProviderServices|usePostgres/);
        expect(source).not.toMatch(/providers\/postgres/);
    });

    it('typechecks the built-in Postgres adapter through the intended public entrypoint', () => {
        const source = read('tests/fixtures/adapter-boundary/postgres-consumer.ts');

        expect(createBuiltInPostgresConnection).toBeDefined();
        expect(createBuiltInPostgresOptions).toBeDefined();
        expect(createBuiltInPostgresIntrospector).toBeDefined();
        expect(source).toContain('PostgresDatabaseConnection');
        expect(source).toContain('PostgresSchemaIntrospector');
        expect(source).toContain('postgresProviderServices');
        expect(source).toContain('usePostgres');
        // the adapter's public entrypoint is now the entitykit/postgres subpath barrel,
        // not the root and not a deeper internal module file
        expect(source).toMatch(/from ['"]\.\.\/\.\.\/\.\.\/src\/providers\/postgres['"]/);
        expect(source).not.toMatch(/providers\/postgres\/\w/);
    });

    it('typechecks a future core-package dry run without concrete adapter imports', () => {
        const packageSource = read('tests/fixtures/adapter-split-dry-run/future-core-package.ts');
        const consumerSource = read('tests/fixtures/adapter-split-dry-run/future-core-consumer.ts');
        const forbiddenConcreteAdapter = /Postgres|PostgresDatabaseConnection|postgresProviderServices|usePostgres|providers\/postgres/;

        expect(createFutureCoreProvider().name).toBe('future-core-provider');
        expect(createFutureCoreContext()).toBeDefined();
        expect(createFutureCoreMigration().id).toBe('20260624120000_FutureCore');
        expect(packageSource).toContain('DatabaseProviderServices');
        expect(packageSource).toContain('DatabaseConnection');
        expect(packageSource).not.toMatch(forbiddenConcreteAdapter);
        expect(packageSource).not.toMatch(/from\s+["']\.\.\/\.\.\/\.\.\/src["']/);
        expect(consumerSource).not.toMatch(forbiddenConcreteAdapter);
    });

    it('typechecks a future testing-package dry run as a package of its own', () => {
        const testingPackageSource = read('tests/fixtures/adapter-split-dry-run/future-testing-package.ts');
        const packageSource = read('tests/fixtures/adapter-split-dry-run/future-core-package.ts');

        // The recording doubles are their own package: core must not re-export
        // them, and a consumer reaches for them through the testing stand-in.
        expect(new FutureTestingRecordingConnection().operations).toEqual([]);
        expect(testingPackageSource).toContain('RecordingDatabaseConnection');
        expect(packageSource).not.toContain('RecordingDatabaseConnection');
        expect(packageSource).not.toMatch(/src\/testing/);
    });

    it('typechecks a future Postgres adapter dry run through core contracts', () => {
        const adapterPackageSource = read('tests/fixtures/adapter-split-dry-run/future-postgres-adapter-package.ts');
        const consumerSource = read('tests/fixtures/adapter-split-dry-run/future-postgres-consumer.ts');

        expect(createFuturePostgresProvider().name).toBe('postgres');
        expect(createFuturePostgresConnection).toBeDefined();
        expect(createFuturePostgresOptions).toBeDefined();
        expect(createFuturePostgresIntrospector).toBeDefined();
        expect(adapterPackageSource).toContain('DatabaseProviderServices');
        expect(adapterPackageSource).toMatch(/providers\/postgres/);
        expect(consumerSource).toContain('DbContextOptionsBuilder');
        expect(consumerSource).toContain('useProvider');
        expect(consumerSource).not.toMatch(/from\s+["']\.\.\/\.\.\/\.\.\/src/);
    });

});
