import { requireDefined } from './support/require-defined';
import fs from 'fs';
import path from 'path';
import { createManagedTempDirectory } from './support/managed-temp-directory';

const mockPools: Array<{
    readonly query: jest.Mock;
    readonly end: jest.Mock;
    readonly on: jest.Mock;
}> = [];

let appliedMigrationIds: readonly string[] = [];
let historyQueryError: Error | undefined;

jest.mock('pg', () => ({
    Pool: jest.fn().mockImplementation(() => {
        const pool = {
            query: jest.fn(async (text: string) => {
                if (text.startsWith('select exists')) {
                    return Promise.resolve({ rows: [{ exists: true }], rowCount: 1 });
                }
                if (text.includes('select "id", "name", "checksum"')) {
                    if (historyQueryError) {
                        throw historyQueryError;
                    }
                    return Promise.resolve({
                        rows: appliedMigrationIds.map(id => ({ id, name: id.split('_').slice(1).join('_'), checksum: 'test-checksum' })),
                        rowCount: appliedMigrationIds.length,
                    });
                }
                return Promise.resolve({ rows: [], rowCount: 0 });
            }),
            end: jest.fn().mockResolvedValue(undefined),
            on: jest.fn(),
        };
        mockPools.push(pool);
        return pool;
    }),
}));

import { runEntityKitCli } from '../packages/cli/src/api';

function createProject(): string {
    const cwd = createManagedTempDirectory('entitykit-remove-applied-');
    fs.writeFileSync(path.join(cwd, 'entitykit.config.ts'), `
    import { defineEntityKitConfig } from "entitykit/cli";
    import { DbContext, type DbContextOptionsBuilder, type ModelBuilder } from "entitykit";
    import { postgresProviderServices } from "entitykit/postgres";

    class RecordingConnection {
      readonly isInTransaction = false;
      async query() { return { rows: [], rowCount: 0 }; }
      async transaction(work: () => unknown | Promise<unknown>) { return work(); }
      async dispose() {}
    }

    class User {
      id!: string;
      email!: string;
    }

    class AppDbContext extends DbContext {
      users = this.set(User);
      protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(new RecordingConnection() as never);
      }
      protected override model(model: ModelBuilder): void {
        model.entity(User, entity => {
          entity.toTable("users", "app");
          entity.hasKey(user => user.id);
          entity.property(user => user.id).hasColumnName("id").hasColumnType("uuid").isRequired();
          entity.property(user => user.email).hasColumnName("email").hasColumnType("text").isRequired();
        });
      }
    }

    export default defineEntityKitConfig({
      context: AppDbContext,
      provider: postgresProviderServices,
      connectionString: "postgres://localhost/entitykit",
      migrationsDir: "migrations",
      snapshot: "migrations/EntityKitModelSnapshot.ts"
    });
  `);
    return cwd;
}

describe('migration remove applied safety', () => {
    beforeEach(() => {
        mockPools.length = 0;
        appliedMigrationIds = [];
        historyQueryError = undefined;
        jest.clearAllMocks();
    });

    it('refuses to remove the latest migration when it has already been applied', async () => {
        const cwd = createProject();
        const add = await runEntityKitCli(['migration', 'add', 'Initial Create'], { cwd, now: new Date('2026-06-01T18:45:30Z') });
        expect(add.exitCode).toBe(0);
        const migrationFile = fs.readdirSync(path.join(cwd, 'migrations')).find(file => file.endsWith('_InitialCreate.ts'));
        expect(migrationFile).toBeDefined();
        const migrationId = requireDefined(migrationFile).replace(/\.ts$/, '');
        appliedMigrationIds = [migrationId];

        const remove = await runEntityKitCli(['migration', 'remove'], { cwd });

        expect(remove.exitCode).toBe(1);
        expect(remove.stderr).toContain(`Migration '${migrationId}' has already been applied`);
        expect(fs.existsSync(path.join(cwd, 'migrations', requireDefined(migrationFile)))).toBe(true);
        expect(mockPools.at(-1)?.end).toHaveBeenCalledTimes(1);
    });

    it('preserves provider failure details in JSON output', async () => {
        const cwd = createProject();
        historyQueryError = Object.assign(new Error('history query failed'), {
            code: '42P01',
            detail: 'relation "__entitykit_migrations" does not exist',
        });

        const remove = await runEntityKitCli(['migration', 'remove', '--json'], { cwd });
        const payload = JSON.parse(remove.stdout) as {
            readonly error: { readonly code: string; readonly details: Record<string, unknown> };
        };

        expect(payload.error).toMatchObject({
            code: 'CLI_ERROR',
            details: {
                provider: 'postgres',
                operation: 'query',
                code: '42P01',
                detail: 'relation "__entitykit_migrations" does not exist',
            },
        });
        const statement = payload.error.details.statement as {
            readonly text: unknown;
            readonly values: unknown;
        };
        expect(statement.text).toEqual(expect.stringContaining('select "id", "name", "checksum"'));
        expect(statement.values).toEqual([]);
    });

    it('prints provider details when reading applied migration history fails', async () => {
        const cwd = createProject();
        const add = await runEntityKitCli(['migration', 'add', 'Initial Create'], { cwd, now: new Date('2026-06-01T18:45:30Z') });
        expect(add.exitCode).toBe(0);
        historyQueryError = Object.assign(new Error('history query failed'), {
            code: '42P01',
            detail: 'relation "__entitykit_migrations" does not exist',
        });

        const remove = await runEntityKitCli(['migration', 'remove'], { cwd });

        expect(remove.exitCode).toBe(1);
        expect(remove.stderr).toContain('Postgres query failed (42P01).');
        expect(remove.stderr).toContain('Operation: query');
        expect(remove.stderr).toContain('Detail: relation "__entitykit_migrations" does not exist');
        expect(remove.stderr).toContain('Statement: select "id", "name", "checksum", "entitykit_version", "applied_at" from "__entitykit_migrations" order by "id"');
        expect(mockPools.at(-1)?.end).toHaveBeenCalledTimes(1);
    });
});
