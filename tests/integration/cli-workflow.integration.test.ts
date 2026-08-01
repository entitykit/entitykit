import { requireDefined } from '../support/require-defined';
import fs from 'fs';
import path from 'path';
import { runEntityKitCli } from '../../src/cli/api';
import { PostgresDatabaseConnection } from '../../src/providers/postgres';
import { createManagedTempDirectory } from '../support/managed-temp-directory';

/**
 * The migration workflow driven the way a developer drives it: scaffold a
 * migration, apply it to a real database, evolve the model, apply again, roll
 * back, and reverse-engineer the result.
 *
 * The existing CLI tests only ever run `db migrate --dry-run`, or assert
 * the failure when no connection is configured, so nothing checked that the
 * commands actually change a database or that they compose across a sequence.
 */
const shouldRunPostgresTests = process.env.RUN_POSTGRES_TESTS === 'true' && Boolean(process.env.DATABASE_URL);
const describePostgres = shouldRunPostgresTests ? describe : describe.skip;

const SCHEMA = 'cli_workflow';

function writeConfig(cwd: string, extraProperty: string): void {
    fs.writeFileSync(path.join(cwd, 'entitykit.config.ts'), `
    import { defineEntityKitConfig } from "entitykit/cli";
    import { DbContext, type DbContextOptionsBuilder, type ModelBuilder } from "entitykit";
    import { postgresProviderServices } from "entitykit/postgres";

    class Widget {
      id!: string;
      name!: string;
      ${extraProperty ? 'sku!: string | null;' : ''}
    }

    class AppDbContext extends DbContext {
      widgets = this.set(Widget);
      protected override configure(options: DbContextOptionsBuilder): void {
        options.usePostgres(process.env.DATABASE_URL!);
      }
      protected override model(model: ModelBuilder): void {
        model.entity(Widget, entity => {
          entity.toTable("widgets", "${SCHEMA}");
          entity.hasKey(widget => widget.id);
          entity.property(widget => widget.id).hasColumnName("id").hasColumnType("text").isRequired();
          entity.property(widget => widget.name).hasColumnName("name").hasColumnType("text").isRequired();
          ${extraProperty}
        });
      }
    }

    export default defineEntityKitConfig({
      context: AppDbContext,
      provider: postgresProviderServices,
      connectionString: process.env.DATABASE_URL,
      migrationsDir: "migrations",
      snapshot: "migrations/EntityKitModelSnapshot.ts"
    });
  `);
}

const WITH_SKU = 'entity.property(widget => widget.sku).hasColumnName("sku").hasColumnType("text");';

describePostgres('migration workflow through the CLI', () => {
    let cwd: string;
    let connection: PostgresDatabaseConnection;

    beforeEach(async () => {
        cwd = createManagedTempDirectory('entitykit-cli-workflow-');
        writeConfig(cwd, '');
        connection = new PostgresDatabaseConnection(requireDefined(process.env.DATABASE_URL));
        await connection.query({ text: `drop schema if exists "${SCHEMA}" cascade`, values: [] });
        await connection.query({ text: 'drop table if exists "__entitykit_migrations" cascade', values: [] });
    });

    afterEach(async () => {
        await connection.query({ text: `drop schema if exists "${SCHEMA}" cascade`, values: [] });
        await connection.query({ text: 'drop table if exists "__entitykit_migrations" cascade', values: [] });
        await connection.dispose();
    });

    async function columns(): Promise<string[]> {
        const result = await connection.query<{ column_name: string }>({
            text: `select column_name from information_schema.columns
             where table_schema = $1 and table_name = 'widgets' order by column_name`,
            values: [SCHEMA],
        });
        return result.rows.map(row => row.column_name);
    }

    async function appliedMigrations(): Promise<string[]> {
        const result = await connection.query<{ id: string }>({
            text: 'select "id" from "__entitykit_migrations" order by "id"',
            values: [],
        });
        return result.rows.map(row => row.id);
    }

    it('scaffolds, applies, evolves, and rolls back against a real database', async () => {
    // 1. Scaffold the first migration from an empty snapshot.
        const first = await runEntityKitCli(['migration', 'add', 'InitialCreate'], { cwd });
        expect(first.stderr).toBe('');
        expect(first.exitCode).toBe(0);

        // 2. Apply it. This is the step no existing test performs.
        const applied = await runEntityKitCli(['db', 'migrate'], { cwd });
        expect(applied.stderr).toBe('');
        expect(applied.exitCode).toBe(0);
        expect(await columns()).toEqual(['id', 'name']);
        expect(await appliedMigrations()).toHaveLength(1);

        // 3. Nothing further to do while the model is unchanged.
        const pending = await runEntityKitCli(['migration', 'check'], { cwd });
        expect(pending.exitCode).toBe(0);

        // 4. Evolve the model and scaffold the change.
        writeConfig(cwd, WITH_SKU);
        const second = await runEntityKitCli(['migration', 'add', 'AddSku'], { cwd });
        expect(second.stderr).toBe('');
        expect(second.exitCode).toBe(0);

        const secondApplied = await runEntityKitCli(['db', 'migrate'], { cwd });
        expect(secondApplied.stderr).toBe('');
        expect(await columns()).toEqual(['id', 'name', 'sku']);
        const both = await appliedMigrations();
        expect(both).toHaveLength(2);

        // 5. Roll back to the first migration.
        const rolledBack = await runEntityKitCli(['db', 'migrate', '--to', both[0]], { cwd });
        expect(rolledBack.stderr).toBe('');
        expect(rolledBack.exitCode).toBe(0);
        expect(await columns()).toEqual(['id', 'name']);
        expect(await appliedMigrations()).toEqual([both[0]]);

        // 6. Re-apply, so the database is forward again.
        await runEntityKitCli(['db', 'migrate'], { cwd });
        expect(await columns()).toEqual(['id', 'name', 'sku']);
    }, 120000);

    it('reverse-engineers the schema it just created', async () => {
        await runEntityKitCli(['migration', 'add', 'InitialCreate'], { cwd });
        await runEntityKitCli(['db', 'migrate'], { cwd });

        const pulled = await runEntityKitCli(
            ['db', 'pull', '--schema', SCHEMA, '--output', 'generated', '--context', 'PulledDbContext'],
            { cwd },
        );
        expect(pulled.stderr).toBe('');
        expect(pulled.exitCode).toBe(0);

        const generated = fs.readFileSync(path.join(cwd, 'generated', 'pulled-db-context.ts'), 'utf8');
        expect(generated).toContain('entity.toTable("widgets", "cli_workflow")');
        expect(generated).toContain('entity.hasKey(row => row.id);');
    }, 120000);

    it('reports migration status against the database', async () => {
        await runEntityKitCli(['migration', 'add', 'InitialCreate'], { cwd });

        const before = await runEntityKitCli(['db', 'status'], { cwd });
        expect(before.exitCode).toBe(0);
        expect(before.stdout).toContain('Pending: 1');

        await runEntityKitCli(['db', 'migrate'], { cwd });

        const after = await runEntityKitCli(['db', 'status'], { cwd });
        expect(after.exitCode).toBe(0);
        expect(after.stdout).toContain('Applied: 1');
        expect(after.stdout).toContain('Pending: 0');
    }, 120000);
});

describePostgres('out-of-order migrations', () => {
    let cwd: string;
    let connection: PostgresDatabaseConnection;

    beforeEach(async () => {
        cwd = createManagedTempDirectory('entitykit-cli-order-');
        writeConfig(cwd, '');
        connection = new PostgresDatabaseConnection(requireDefined(process.env.DATABASE_URL));
        await connection.query({ text: `drop schema if exists "${SCHEMA}" cascade`, values: [] });
        await connection.query({ text: 'drop table if exists "__entitykit_migrations" cascade', values: [] });
    });

    afterEach(async () => {
        await connection.query({ text: `drop schema if exists "${SCHEMA}" cascade`, values: [] });
        await connection.query({ text: 'drop table if exists "__entitykit_migrations" cascade', values: [] });
        await connection.dispose();
    });

    it('reports a pending migration that sorts before the newest applied one', async () => {
        await runEntityKitCli(['migration', 'add', 'InitialCreate'], { cwd });
        await runEntityKitCli(['db', 'migrate'], { cwd });

        // A migration merged from another branch, authored earlier than the one
        // already applied. Selecting a range from the newest applied id would leave
        // it outside the slice, so `update` would report success while `status`
        // still listed it as pending.
        const applied = await connection.query<{ id: string }>({
            text: 'select "id" from "__entitykit_migrations"', values: [],
        });
        const earlierId = `${String(Number(applied.rows[0].id.slice(0, 14)) - 1)}_EarlierBranch`;
        fs.writeFileSync(path.join(cwd, 'migrations', `${earlierId}.ts`), `
      import { Migration, MigrationBuilder } from "entitykit/migrations";
      export class EarlierBranch extends Migration {
        readonly id = ${JSON.stringify(earlierId)};
        readonly name = "EarlierBranch";
        override up(builder: MigrationBuilder): void {
          builder.addColumn("widgets", { name: "note", type: "text", nullable: true }, "${SCHEMA}");
        }
        override down(builder: MigrationBuilder): void {
          builder.dropColumn("widgets", "note", "${SCHEMA}");
        }
      }
    `);

        const update = await runEntityKitCli(['db', 'migrate'], { cwd });
        const explicitLatest = await runEntityKitCli(['db', 'migrate', '--to', 'latest'], { cwd });

        expect(update.exitCode).toBe(1);
        expect(update.stderr).toContain(earlierId);
        expect(update.stderr).toContain('would be skipped');
        expect(explicitLatest.exitCode).toBe(1);
        expect(explicitLatest.stderr).toContain('would be skipped');

        // And the schema is untouched, rather than half-applied.
        const columns = await connection.query<{ column_name: string }>({
            text: `select column_name from information_schema.columns
             where table_schema = $1 and table_name = 'widgets'`,
            values: [SCHEMA],
        });
        expect(columns.rows.map(row => row.column_name).sort()).toEqual(['id', 'name']);
    }, 120000);
});
