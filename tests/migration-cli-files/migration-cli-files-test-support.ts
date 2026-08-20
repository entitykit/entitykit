import fs from 'fs';
import path from 'path';
import { createManagedTempDirectory } from '../support/managed-temp-directory';

export function createProject(): string {
    const cwd = createManagedTempDirectory('entitykit-cli-files-');
    fs.writeFileSync(path.join(cwd, 'entitykit.config.ts'), `
    import { defineEntityKitConfig } from "@entitykit/core";
    import { DbContext, type DbContextOptionsBuilder, type ModelBuilder } from "@entitykit/core";
    import { postgresProviderServices } from "@entitykit/postgres";

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
      migrationsDir: "migrations",
      snapshot: "migrations/EntityKitModelSnapshot.ts"
    });
  `);
    return cwd;
}

export function removeEmailFromProjectConfig(cwd: string): void {
    const configPath = path.join(cwd, 'entitykit.config.ts');
    const source = fs.readFileSync(configPath, 'utf8');
    fs.writeFileSync(configPath, source.replace(
        '          entity.property(user => user.email).hasColumnName("email").hasColumnType("text").isRequired();\n',
        '',
    ), 'utf8');
}

export function renameEmailColumnInProjectConfig(cwd: string): void {
    const configPath = path.join(cwd, 'entitykit.config.ts');
    const source = fs.readFileSync(configPath, 'utf8');
    fs.writeFileSync(configPath, source.replace(
        'entity.property(user => user.email).hasColumnName("email").hasColumnType("text").isRequired();',
        'entity.property(user => user.email).hasColumnName("contact_email").hasColumnType("text").isRequired();',
    ), 'utf8');
}

export function createProjectWithCustomProvider(
    appliedMigrations: ReadonlyArray<string | {
        readonly id: string;
        readonly name?: string;
        readonly checksum?: string;
    }> = [],
): string {
    const cwd = createManagedTempDirectory('entitykit-cli-provider-');
    const appliedRows = appliedMigrations.map(item => {
        const id = typeof item === 'string' ? item : item.id;
        return {
            id,
            name: typeof item === 'string'
                ? id.split('_').slice(1).join('_')
                : item.name ?? id.split('_').slice(1).join('_'),
            ...typeof item === 'string' || item.checksum === undefined
                ? {}
                : { checksum: item.checksum },
            entitykit_version: 'test-version',
        };
    });
    fs.writeFileSync(path.join(cwd, 'entitykit.config.ts'), `
    import { defineEntityKitConfig } from "@entitykit/core";
    import {
      DbContext,
      DbContextOptionsBuilder,
      ModelBuilder,
      OperationCanceledError,
      type DatabaseConnection,
      type DatabaseOperationOptions,
      type DatabaseProviderServices,
      type DatabaseQueryResult,
      type MigrationSqlDialect,
      type SqlDialect,
      type SqlStatement
    } from "@entitykit/core";
    import { MigrationBuilder } from "@entitykit/core/migrations";

    const appliedRows = ${JSON.stringify(appliedRows)};

    class RecordingConnection implements DatabaseConnection {
      readonly isInTransaction = false;
      readonly statements: SqlStatement[] = [];
      async query(statement: SqlStatement, options?: DatabaseOperationOptions): Promise<DatabaseQueryResult> {
        if (options?.signal?.aborted) throw new OperationCanceledError(options.signal.reason);
        this.statements.push(statement);
        if (statement.text === "select 1 as [exists]") {
          return { rows: [{ exists: 1 }], rowCount: 1 };
        }
        if (statement.text.startsWith("select")) {
          return { rows: appliedRows, rowCount: appliedRows.length };
        }
        return { rows: [], rowCount: 1 };
      }
      async transaction(work: () => unknown | Promise<unknown>): Promise<unknown> {
        return work();
      }
      async dispose(): Promise<void> {}
    }

    const sql: SqlDialect = {
      name: "custom-sql",
      quoteIdentifier: identifier => "[" + identifier.replace(/]/g, "]]") + "]",
      quoteQualifiedIdentifier: (...identifiers) => identifiers.filter(Boolean).map(identifier => "[" + String(identifier).replace(/]/g, "]]") + "]").join("."),
      parameter: () => "?",
      countAllExpression: () => "count(*)",
      falsePredicate: () => "0 = 1",
      insertConflictDoNothingClause: () => "on conflict do nothing"
    };

    const migrationDialect: MigrationSqlDialect = {
      name: "custom-migrations",
      sql,
      createMigrationHistoryTableStatement: () => ({ text: "create table if not exists [migrations] ([id] text primary key)", values: [] }),
      selectMigrationHistoryStatement: () => ({ text: "select [id], [name], [checksum], [entitykit_version] from [migrations] order by [id]", values: [] }),
      migrationHistoryTableExistsStatement: () => ({ text: "select 1 as [exists]", values: [] }),
      insertMigrationHistoryStatement: (migration, checksum) => ({ text: "insert into [migrations] ([id], [name], [checksum], [entitykit_version]) values (?, ?, ?, ?)", values: [migration.id, migration.name, checksum, "test"] }),
      deleteMigrationHistoryStatement: migration => ({ text: "delete from [migrations] where [id] = ?", values: [migration.id] })
    };

    const provider: DatabaseProviderServices = {
      name: "custom-provider",
      dialect: sql,
      migrationDialect,
      createMigrationBuilder: () => new MigrationBuilder(sql),
      createConnection: () => new RecordingConnection()
    };

    class User {
      id!: string;
      email!: string;
    }

    class AppDbContext extends DbContext {
      users = this.set(User);
      protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(new RecordingConnection(), {
          provider: "custom",
          dialect: sql,
          migrationDialect,
        });
      }
      protected override model(model: ModelBuilder): void {
        model.entity(User, entity => {
          entity.toTable("users");
          entity.hasKey(user => user.id);
          entity.property(user => user.id).hasColumnName("id").hasColumnType("text").isRequired();
          entity.property(user => user.email).hasColumnName("email").hasColumnType("text").isRequired();
        });
      }
    }

    export default defineEntityKitConfig({
      context: AppDbContext,
      migrationsDir: "migrations",
      snapshot: "migrations/EntityKitModelSnapshot.ts",
      connectionString: "custom://memory",
      provider
    });
  `);
    return cwd;
}

export function createProjectWithThrowingProvider(): string {
    const cwd = createManagedTempDirectory('entitykit-cli-dry-run-');
    fs.writeFileSync(path.join(cwd, 'entitykit.config.ts'), `
    import { defineEntityKitConfig } from "@entitykit/core";
    import {
      DbContext,
      DbContextOptionsBuilder,
      ModelBuilder,
      type DatabaseConnection,
      type DatabaseProviderServices,
      type DatabaseQueryResult,
      type MigrationSqlDialect,
      type SqlDialect,
      type SqlStatement
    } from "@entitykit/core";
    import { MigrationBuilder } from "@entitykit/core/migrations";

    class RecordingConnection implements DatabaseConnection {
      readonly isInTransaction = false;
      async query(): Promise<DatabaseQueryResult> { return { rows: [], rowCount: 1 }; }
      async transaction(work: () => unknown | Promise<unknown>): Promise<unknown> { return work(); }
      async dispose(): Promise<void> {}
    }

    const sql: SqlDialect = {
      name: "dry-run-sql",
      quoteIdentifier: identifier => '"' + identifier + '"',
      quoteQualifiedIdentifier: (...identifiers) => identifiers.filter(Boolean).map(identifier => '"' + String(identifier) + '"').join("."),
      parameter: index => "$" + index,
      countAllExpression: () => "count(*)",
      falsePredicate: () => "false",
      insertConflictDoNothingClause: () => "on conflict do nothing"
    };

    const migrationDialect: MigrationSqlDialect = {
      name: "dry-run-migrations",
      sql,
      createMigrationHistoryTableStatement: () => ({ text: 'create table if not exists "__migrations" ("id" text primary key)', values: [] }),
      selectMigrationHistoryStatement: () => ({ text: 'select "id", "name", "checksum", "entitykit_version" from "__migrations" order by "id"', values: [] }),
      insertMigrationHistoryStatement: (migration, checksum) => ({ text: 'insert into "__migrations" ("id", "name", "checksum", "entitykit_version") values ($1, $2, $3, $4)', values: [migration.id, migration.name, checksum, "test"] }),
      deleteMigrationHistoryStatement: migration => ({ text: 'delete from "__migrations" where "id" = $1', values: [migration.id] })
    };

    const provider: DatabaseProviderServices = {
      name: "throwing-provider",
      dialect: sql,
      migrationDialect,
      createMigrationBuilder: () => new MigrationBuilder(sql),
      createConnection: () => { throw new Error("dry-run opened a database connection"); }
    };

    class User {
      id!: string;
    }

    class AppDbContext extends DbContext {
      users = this.set(User);
      protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(new RecordingConnection(), {
          provider: "dry-run",
          dialect: sql,
          migrationDialect,
        });
      }
      protected override model(model: ModelBuilder): void {
        model.entity(User, entity => {
          entity.toTable("users");
          entity.hasKey(user => user.id);
          entity.property(user => user.id).hasColumnName("id").hasColumnType("text").isRequired();
        });
      }
    }

    export default defineEntityKitConfig({
      context: AppDbContext,
      migrationsDir: "migrations",
      snapshot: "migrations/EntityKitModelSnapshot.ts",
      connectionString: "custom://dry-run",
      provider
    });
  `);
    return cwd;
}
