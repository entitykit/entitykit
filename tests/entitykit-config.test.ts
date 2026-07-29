import fs from 'fs';
import path from 'path';
import {
    loadEntityKitConfig,
    resolveEntityKitConnection,
} from '../src/cli/api';
import type { PostgresConnectionConfig } from '../src';
import { postgresProviderServices } from '../src/providers/postgres';
import { createManagedTempDirectory } from './support/managed-temp-directory';

function createTempProject(): string {
    return createManagedTempDirectory('entitykit-config-');
}

describe('EntityKit config loading', () => {
    const providerKey = Symbol.for('entitykit.tests.provider');

    beforeEach(() => {
        Reflect.set(globalThis, providerKey, postgresProviderServices);
    });

    afterEach(() => {
        Reflect.deleteProperty(globalThis, providerKey);
    });

    it('loads JavaScript config files and resolves migration paths', async () => {
        const cwd = createTempProject();
        fs.writeFileSync(path.join(cwd, 'entitykit.config.js'), `
      class TestContext { static create() { return new TestContext(); } }
      module.exports = {
        context: TestContext,
        provider: globalThis[Symbol.for("entitykit.tests.provider")],
        migrationsDir: "migrations",
        snapshot: "migrations/Snapshot.ts",
        connectionString: () => "postgres://localhost/entitykit"
      };
    `);

        const config = await loadEntityKitConfig({ cwd });

        expect(config.configPath).toBe(path.join(cwd, 'entitykit.config.js'));
        expect(config.migrationsDir).toBe(path.join(cwd, 'migrations'));
        expect(config.snapshot).toBe(path.join(cwd, 'migrations', 'Snapshot.ts'));
        expect(config.provider).toBe(postgresProviderServices);
        expect(typeof config.connectionString).toBe('function');
    });

    it('loads custom provider services from config', async () => {
        const cwd = createTempProject();
        fs.writeFileSync(path.join(cwd, 'entitykit.config.js'), `
      class TestContext { static create() { return new TestContext(); } }
      const { MigrationBuilder } = require("entitykit/migrations");
      const provider = {
        name: "custom-test",
        dialect: {
          name: "custom-sql",
          quoteIdentifier: (identifier) => "[" + identifier + "]",
          quoteQualifiedIdentifier: (...identifiers) => identifiers.filter(Boolean).map(identifier => "[" + identifier + "]").join("."),
          parameter: () => "?",
          countAllExpression: () => "count(*)",
          falsePredicate: () => "0 = 1",
          insertConflictDoNothingClause: () => "on conflict do nothing"
        },
        migrationDialect: {
          name: "custom-test",
          sql: {
            name: "custom-sql",
            quoteIdentifier: (identifier) => "[" + identifier + "]",
            quoteQualifiedIdentifier: (...identifiers) => identifiers.filter(Boolean).map(identifier => "[" + identifier + "]").join("."),
            parameter: () => "?",
            countAllExpression: () => "count(*)",
            falsePredicate: () => "0 = 1",
            insertConflictDoNothingClause: () => "on conflict do nothing"
          },
          createMigrationHistoryTableStatement: () => ({ text: "create table migrations", values: [] }),
          selectMigrationHistoryStatement: () => ({ text: "select id from migrations", values: [] }),
          insertMigrationHistoryStatement: () => ({ text: "insert migration", values: [] }),
          deleteMigrationHistoryStatement: () => ({ text: "delete migration", values: [] })
        },
        createMigrationBuilder: () => new MigrationBuilder(provider.dialect),
        createConnection: () => ({ isInTransaction: false, query: async () => ({ rows: [], rowCount: 0 }), transaction: async (work) => work() })
      };
      module.exports = { context: TestContext, provider };
    `);

        const config = await loadEntityKitConfig({ cwd });

        expect(config.provider.name).toBe('custom-test');
    });

    it('loads a TypeScript config and its extensionless TypeScript imports', async () => {
        const cwd = createTempProject();
        fs.mkdirSync(path.join(cwd, 'src'));
        fs.writeFileSync(path.join(cwd, 'src', 'app-context.ts'), `
      export class AppContext {
        static create(): AppContext {
          return new AppContext();
        }
      }
    `);
        fs.writeFileSync(path.join(cwd, 'entitykit.config.ts'), `
      import { defineEntityKitConfig } from "entitykit/cli";
      import { postgresProviderServices } from "entitykit/postgres";
      import { AppContext } from "./src/app-context";
      export default defineEntityKitConfig({
        context: AppContext as never,
        provider: postgresProviderServices,
        migrationsDir: "db/migrations"
      });
    `);

        const config = await loadEntityKitConfig({ cwd });

        expect(config.configPath).toBe(path.join(cwd, 'entitykit.config.ts'));
        expect(config.context.create()).toBeInstanceOf(config.context);
        expect(config.migrationsDir).toBe(path.join(cwd, 'db', 'migrations'));
        expect(config.snapshot).toBe(path.join(cwd, 'db', 'migrations', 'EntityKitModelSnapshot.ts'));
    });

    it('loads Node import.meta paths from an ESM-style TypeScript config', async () => {
        const cwd = createTempProject();
        const configPath = path.join(cwd, 'entitykit.config.mts');
        fs.writeFileSync(configPath, `
          import { postgresProviderServices } from "entitykit/postgres";
          class TestContext { static create() { return new TestContext(); } }
          export default {
            context: TestContext,
            provider: postgresProviderServices,
            migrationsDir: import.meta.dirname,
            snapshot: import.meta.filename
          };
        `);

        const config = await loadEntityKitConfig({ cwd });

        expect(config.migrationsDir).toBe(cwd);
        expect(config.snapshot).toBe(configPath);
    });

    it('reports missing config files clearly', async () => {
        await expect(loadEntityKitConfig({ cwd: createTempProject() }))
            .rejects.toThrow('Could not find an EntityKit config file');
    });

    it('rejects malformed config values during loading', async () => {
        const cwd = createTempProject();
        fs.writeFileSync(path.join(cwd, 'entitykit.config.js'), `
      class TestContext { static create() { return new TestContext(); } }
      module.exports = {
        context: TestContext,
        provider: globalThis[Symbol.for("entitykit.tests.provider")],
        migrationsDir: "",
        now: "today"
      };
    `);

        await expect(loadEntityKitConfig({ cwd }))
            .rejects.toThrow('migrationsDir must be a non-empty string');
    });

    it('requires an explicit provider in a multi-provider project', async () => {
        const cwd = createTempProject();
        fs.writeFileSync(path.join(cwd, 'entitykit.config.js'), `
          class TestContext { static create() { return new TestContext(); } }
          module.exports = { context: TestContext };
        `);

        await expect(loadEntityKitConfig({ cwd }))
            .rejects.toThrow('must specify provider services');
    });

    it('walks upward and resolves project paths from the config directory', async () => {
        const cwd = createTempProject();
        const nested = path.join(cwd, 'packages', 'app', 'src');
        fs.mkdirSync(nested, { recursive: true });
        fs.writeFileSync(path.join(cwd, 'entitykit.config.ts'), `
          import { postgresProviderServices } from "entitykit/postgres";
          class TestContext { static create() { return new TestContext(); } }
          export default { context: TestContext, provider: postgresProviderServices, migrationsDir: "db/migrations" };
        `);

        const config = await loadEntityKitConfig({ cwd: nested });

        expect(config.projectRoot).toBe(cwd);
        expect(config.migrationsDir).toBe(path.join(cwd, 'db', 'migrations'));
    });

    it('validates custom provider contracts during loading', async () => {
        const cwd = createTempProject();
        fs.writeFileSync(path.join(cwd, 'entitykit.config.js'), `
      class TestContext { static create() { return new TestContext(); } }
      module.exports = {
        context: TestContext,
        provider: { name: "broken" }
      };
    `);

        await expect(loadEntityKitConfig({ cwd }))
            .rejects.toThrow('Database provider \'broken\' must supply a runtime SQL dialect');
    });

    it('validates configured clock results when used', async () => {
        const cwd = createTempProject();
        fs.writeFileSync(path.join(cwd, 'entitykit.config.js'), `
      class TestContext { static create() { return new TestContext(); } }
      module.exports = {
        context: TestContext,
        provider: globalThis[Symbol.for("entitykit.tests.provider")],
        now: () => new Date("invalid")
      };
    `);

        const config = await loadEntityKitConfig({ cwd });
        expect(() => config.now()).toThrow('now must return a valid Date');
    });

    it('resolves typed connection objects and async credential callbacks', async () => {
        const connection: PostgresConnectionConfig = {
            host: 'db.internal',
            applicationName: 'entitykit-cli',
            commandTimeoutMs: 5000,
        };

        await expect(resolveEntityKitConnection({
            connection: async () => Promise.resolve(connection),
        })).resolves.toBe(connection);
    });

    it('rejects invalid callback results before provider construction', async () => {
        await expect(resolveEntityKitConnection({
            connection: jest.fn().mockResolvedValue(''),
        })).rejects.toThrow('EntityKit connection must not be empty');
        await expect(resolveEntityKitConnection({
            connection: jest.fn().mockResolvedValue(42),
        })).rejects.toThrow(
            'EntityKit connection must resolve to a connection string or configuration object',
        );
    });
});
