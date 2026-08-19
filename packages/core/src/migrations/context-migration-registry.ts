import type { ModelSnapshot } from '../model/model-snapshot-types';
import type { Migration } from './migration';
import type {
    MigrationOperationOptions,
    MigrationUpdateOptions,
    MigrationUpdateResult,
} from './migration-runner';

/** Internal operations supplied by the real DbContext runtime. */
export interface ContextMigrationHost {
    createModelSnapshot(): ModelSnapshot;
    generateMigrationScript(
        migration: Migration,
        direction?: 'up' | 'down',
    ): string;
    applyMigration(migration: Migration, options?: MigrationOperationOptions): Promise<void>;
    updateDatabase(
        migrations: readonly Migration[],
        options?: MigrationUpdateOptions,
    ): Promise<MigrationUpdateResult>;
    revertMigration(migration: Migration, options?: MigrationOperationOptions): Promise<void>;
}

const migrationHosts: WeakMap<object, ContextMigrationHost> = new WeakMap();

/** Associate the application facade with its internal migration host. */
export function registerContextMigrationHost(
    context: object,
    host: ContextMigrationHost,
): void {
    migrationHosts.set(context, host);
}

/** Resolve migration operations for a context created by EntityKit. */
export function getContextMigrationHost(context: object): ContextMigrationHost {
    const host = migrationHosts.get(context);
    if (!host) {
        throw new TypeError(
            'contextMigrations() requires a DbContext instance created by EntityKit.',
        );
    }
    return host;
}
