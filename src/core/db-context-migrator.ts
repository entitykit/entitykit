import type { DatabaseConnection } from '../storage/database-connection';
import type { Migration } from '../migrations/migration';
import {
    MigrationRunner,
    type MigrationOperationOptions,
    type MigrationUpdateOptions,
    type MigrationUpdateResult,
} from '../migrations/migration-runner';
import { MigrationSqlGenerator } from '../migrations/migration-sql-generator';
import type { DbContextOptions } from './context-options/db-context-option-types';

/**
 * The migration-runner side of a `DbContext`: script generation and the
 * apply/update/revert operations that drive `MigrationRunner`. Held apart from
 * the unit-of-work hub because it is a distinct concern — turning migrations
 * into DDL and executing them — that only borrows the context's connection and
 * options. `DbContext` keeps the one-line public methods and delegates here.
 */
export class DbContextMigrator {
    constructor(
        private readonly getConnection: () => DatabaseConnection,
        private readonly getOptions: () => DbContextOptions,
    ) {}

    public generateScript(migration: Migration, direction: 'up' | 'down'): string {
        const generator = new MigrationSqlGenerator(
            this.getOptions().migrationDialect,
            this.getOptions().createMigrationBuilder,
        );
        return direction === 'up'
            ? generator.generateUpScript(migration)
            : generator.generateDownScript(migration);
    }

    public async apply(migration: Migration, options?: MigrationOperationOptions): Promise<void> {
        return this.runner().apply(migration, options);
    }

    public async update(migrations: readonly Migration[], options: MigrationUpdateOptions): Promise<MigrationUpdateResult> {
        return this.runner().update(migrations, options);
    }

    public async revert(migration: Migration, options?: MigrationOperationOptions): Promise<void> {
        return this.runner().revert(migration, options);
    }

    private runner(): MigrationRunner {
        const database = this.getConnection();
        const options = this.getOptions();
        return new MigrationRunner(
            database,
            options.migrationDialect,
            options.createMigrationBuilder,
            {
                provider: options.provider.provider,
                diagnostics: options.diagnostics,
            },
        );
    }
}
