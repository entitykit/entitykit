import type { DatabaseConnection } from '../storage/database-connection';
import type { Migration } from './migration';
import type {
    MigrationOperationOptions,
    MigrationUpdateOptions,
    MigrationUpdateResult,
} from './migration-runner';
import type { ModelSnapshot } from '../model/model-snapshot-types';
import { getContextMigrationHost } from './context-migration-registry';

/** Minimal context shape accepted by migration tooling. */
export interface MigrationContext {
    /** The database. */ readonly database: {
        /** The connection. */ readonly connection: DatabaseConnection;
        /** The provider name. */ readonly providerName: string;
    };
}

/** Migration and snapshot operations kept outside the application root API. */
export interface ContextMigrations {
    /** Create model snapshot. */ createModelSnapshot(): ModelSnapshot;
    /** Perform the generate script operation. */ generateScript(migration: Migration, direction?: 'up' | 'down'): string;
    /** Perform the apply operation. */ apply(migration: Migration, options?: MigrationOperationOptions): Promise<void>;
    /** Perform the update operation. */ update(
        migrations: readonly Migration[],
        options?: MigrationUpdateOptions,
    ): Promise<MigrationUpdateResult>;
    /** Perform the revert operation. */ revert(migration: Migration, options?: MigrationOperationOptions): Promise<void>;
}

/** Bind migration tooling to a context without widening the root API. */
export function contextMigrations(context: MigrationContext): ContextMigrations {
    const host = getContextMigrationHost(context);
    return {
        createModelSnapshot: () => host.createModelSnapshot(),
        generateScript: (migration, direction) =>
            host.generateMigrationScript(migration, direction),
        apply: async (migration, options) => host.applyMigration(migration, options),
        update: async (migrations, options) =>
            host.updateDatabase(migrations, options),
        revert: async (migration, options) => host.revertMigration(migration, options),
    };
}
