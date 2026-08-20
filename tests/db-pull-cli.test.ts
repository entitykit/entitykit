import fs from 'fs';
import path from 'path';
import {
    type DbPullQueryImplementation,
    reviewDbPullIntrospection,
    standardDbPullIntrospection,
} from './support/db-pull-introspection-fixtures';
import { createManagedTempDirectory } from './support/managed-temp-directory';

const mockPools: Array<{
    readonly query: jest.Mock;
    readonly end: jest.Mock;
    readonly on: jest.Mock;
}> = [];

let queryImplementation: DbPullQueryImplementation | undefined;

jest.mock('pg', () => ({
    Pool: jest.fn().mockImplementation(() => {
        const pool = {
            query: jest.fn(async (text: string, values: readonly unknown[]) => {
                if (!queryImplementation) {
                    return Promise.reject(new Error('No introspection rows were queued.'));
                }
                return queryImplementation(text, values);
            }),
            end: jest.fn().mockResolvedValue(undefined),
            on: jest.fn(),
        };
        mockPools.push(pool);
        return pool;
    }),
}));

import { runEntityKitCli } from '../packages/cli/src/api';

function createProject(connectionString = 'postgres://localhost/entitykit'): string {
    const cwd = createManagedTempDirectory('entitykit-db-pull-');
    fs.writeFileSync(path.join(cwd, 'entitykit.config.ts'), `
    import { postgresProviderServices } from "entitykit/postgres";
    class TestContext { static create() { return new TestContext(); } }
    export default {
      context: TestContext,
      provider: postgresProviderServices,
      connectionString: ${JSON.stringify(connectionString)}
    };
  `);
    return cwd;
}

function createProjectWithoutConnectionString(): string {
    const cwd = createManagedTempDirectory('entitykit-db-pull-');
    fs.writeFileSync(path.join(cwd, 'entitykit.config.ts'), `
    import { postgresProviderServices } from "entitykit/postgres";
    class TestContext { static create() { return new TestContext(); } }
    export default { context: TestContext, provider: postgresProviderServices };
  `);
    return cwd;
}

function createProjectWithProviderWithoutIntrospection(): string {
    const cwd = createManagedTempDirectory('entitykit-db-pull-');
    fs.writeFileSync(path.join(cwd, 'entitykit.config.js'), `
    class TestContext { static create() { return new TestContext(); } }
    const { MigrationBuilder } = require("entitykit/migrations");
    const provider = {
      name: "custom-provider",
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
        name: "custom-migrations",
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
      createConnection: () => ({ isInTransaction: false, query: async () => ({ rows: [], rowCount: 0 }), transaction: async (work) => work(), dispose: async () => {} })
    };
    module.exports = { context: TestContext, connectionString: "custom://memory", provider };
  `);
    return cwd;
}

function pool(): { readonly query: jest.Mock; readonly end: jest.Mock; } {
    const current = mockPools.at(-1);
    if (!current) {
        throw new Error('Pool was not constructed.');
    }
    return current;
}

function queueIntrospectionRows(): void {
    queryImplementation = standardDbPullIntrospection;
}

function queueReviewIntrospectionRows(): void {
    queryImplementation = reviewDbPullIntrospection;
}

describe('db pull CLI', () => {
    beforeEach(() => {
        mockPools.length = 0;
        queryImplementation = undefined;
        jest.clearAllMocks();
    });

    it('prints generated starter code from a live introspection snapshot', async () => {
        const cwd = createProject();
        queueIntrospectionRows();

        const result = await runEntityKitCli(['db', 'pull', '--schema', 'app', '--context', 'PulledDbContext', '--stdout'], { cwd });

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('// user.ts');
        expect(result.stdout).toContain('export class User');
        expect(result.stdout).toContain('email!: string;');
        expect(result.stdout).toContain('// pulled-db-context.ts');
        expect(result.stdout).toContain('export class PulledDbContext extends DbContext');
        const queryCalls = pool().query.mock.calls as unknown as ReadonlyArray<
            readonly [string, readonly unknown[]]
        >;
        expect(queryCalls.map(([, values]) => values)).toEqual(
            Array.from({ length: 6 }, () => [['app']]),
        );
        expect(pool().end).toHaveBeenCalledTimes(1);
    });

    it('prints db pull diagnostics after generated starter code', async () => {
        const cwd = createProject();
        queueIntrospectionRows();

        const result = await runEntityKitCli(['db', 'pull', '--schema', 'app', '--context', 'User', '--stdout'], { cwd });

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('// user.ts');
        expect(result.stdout).toContain('// user2.ts');
        expect(result.stdout).toContain('Review required:');
        expect(result.stdout).toContain('Generated names:');
        expect(result.stdout).toContain('Requested DbContext name \'User\' was rewritten to \'User2\'');
        expect(pool().end).toHaveBeenCalledTimes(1);
    });

    it('groups db pull review diagnostics in CLI output', async () => {
        const cwd = createProject();
        queueReviewIntrospectionRows();

        const result = await runEntityKitCli(['db', 'pull', '--schema', 'app', '--context', 'PulledDbContext', '--stdout'], { cwd });

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain('Review required:');
        expect(result.stdout).toContain('  Tables:');
        expect(result.stdout).toContain('Table "app"."posts" has no primary key');
        expect(result.stdout).toContain('entity.hasNoKey()');
        expect(result.stdout).toContain('  Columns:');
        expect(result.stdout).toContain('Column "app"."posts"."review_state" uses store type \'review_state\'');
        expect(result.stdout).toContain('  Indexes:');
        expect(result.stdout).toContain('Index \'ix_posts_review_lookup\' on "app"."posts" references column(s) review_state_sort_key');
        expect(result.stdout).toContain('  Relationships:');
        expect(result.stdout).toContain('Foreign key \'fk_posts_auth_users_author_id\'');
        expect(result.stdout).not.toContain('Generated names:');
        expect(pool().end).toHaveBeenCalledTimes(1);
    });

    it('writes generated starter files to the requested output directory', async () => {
        const cwd = createProject();
        queueIntrospectionRows();

        const result = await runEntityKitCli(['db', 'pull', '--schema', 'app', '--output', 'generated', '--context', 'PulledDbContext'], { cwd });

        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe('Wrote 2 db pull file(s) to generated.');
        expect(fs.readFileSync(path.join(cwd, 'generated', 'user.ts'), 'utf8')).toContain('export class User');
        expect(fs.readFileSync(path.join(cwd, 'generated', 'pulled-db-context.ts'), 'utf8')).toContain('users = this.set<User, [User["id"]]>(User);');
        expect(pool().end).toHaveBeenCalledTimes(1);
    });

    it('preflights every generated path before writing', async () => {
        const cwd = createProject();
        queueIntrospectionRows();
        fs.mkdirSync(path.join(cwd, 'generated'));
        fs.writeFileSync(path.join(cwd, 'generated', 'user.ts'), 'keep me');

        const result = await runEntityKitCli([
            'db', 'pull', '--output', 'generated',
        ], { cwd });

        expect(result).toMatchObject({ exitCode: 1, outcome: 'error' });
        expect(fs.readFileSync(path.join(cwd, 'generated', 'user.ts'), 'utf8')).toBe('keep me');
        expect(fs.existsSync(path.join(cwd, 'generated', 'app-db-context.ts'))).toBe(false);
    });

    it('returns non-zero when connection string is missing', async () => {
        const previousDatabaseUrl = process.env.DATABASE_URL;
        delete process.env.DATABASE_URL;
        const result = await runEntityKitCli(['db', 'pull'], { cwd: createProjectWithoutConnectionString() });
        if (previousDatabaseUrl === undefined) {
            delete process.env.DATABASE_URL;
        } else {
            process.env.DATABASE_URL = previousDatabaseUrl;
        }

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('db pull requires connection');
        expect(mockPools).toHaveLength(0);
    });

    it('returns non-zero when the configured provider does not support db pull', async () => {
        const result = await runEntityKitCli(['db', 'pull'], { cwd: createProjectWithProviderWithoutIntrospection() });

        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain('db pull is not available for provider \'custom-provider\'');
        expect(mockPools).toHaveLength(0);
    });
});
