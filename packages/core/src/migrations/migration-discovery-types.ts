import type { Migration } from './migration';

/** Public contract for discovered migration. */ export interface DiscoveredMigration {
    /** The migration. */ readonly migration: Migration;
    /** The file path. */ readonly filePath: string;
}

/** Result produced by migration discovery. */ export interface MigrationDiscoveryResult {
    /** The migrations. */ readonly migrations: readonly DiscoveredMigration[];
}
