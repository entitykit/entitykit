import type { Migration } from '../migrations/migration';
import type {
    MigrationOperationOptions,
    MigrationUpdateOptions,
    MigrationUpdateResult,
} from '../migrations/runner/migration-runner-options';
import type { ModelSnapshot } from '../model/model-snapshot-types';
import { SchemaSqlBuilder } from '../schema/schema-sql-builder';
import { DbContextMigrator } from './db-context-migrator';
import { DbContextQuery } from './db-context-query';

/** Schema snapshots and migration operations exposed by a context. */
export abstract class DbContextMigrations extends DbContextQuery {
    private readonly migrator = new DbContextMigrator(
        () => this.databaseConnection,
        () => this.options,
    );

    public createSchemaScript(): string {
        return new SchemaSqlBuilder(this.dialect).build(this.modelMetadata);
    }

    public createSchemaStatements(): readonly string[] {
        return new SchemaSqlBuilder(this.dialect)
            .buildStatements(this.modelMetadata);
    }

    public createModelSnapshot(): ModelSnapshot {
        return this.modelMetadata.toSnapshot();
    }

    public generateMigrationScript(
        migration: Migration,
        direction: 'up' | 'down' = 'up',
    ): string {
        return this.migrator.generateScript(migration, direction);
    }

    public async applyMigration(
        migration: Migration,
        options?: MigrationOperationOptions,
    ): Promise<void> {
        return this.migrator.apply(migration, options);
    }

    public async updateDatabase(
        migrations: readonly Migration[],
        options: MigrationUpdateOptions = {},
    ): Promise<MigrationUpdateResult> {
        return this.migrator.update(migrations, options);
    }

    public async revertMigration(
        migration: Migration,
        options?: MigrationOperationOptions,
    ): Promise<void> {
        return this.migrator.revert(migration, options);
    }
}
