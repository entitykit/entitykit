/**
 * Compatibility exports for the original migration discovery module.
 *
 * Production modules import directory discovery and file loading directly.
 */
export { discoverMigrations } from './migration-directory-discovery';
export type {
    DiscoveredMigration,
    MigrationDiscoveryResult,
} from './migration-discovery-types';
export { loadMigrationFile } from './migration-file-loader';
