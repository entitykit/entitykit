import type { MigrationBuilderFactory } from '../migrations/migration-builder-contract';
import type { MigrationSqlDialect } from '../migrations/migration-sql-dialect';
import type { SqlDialect } from '../sql/sql-dialect';
import type { DatabaseConnection } from './database-connection';
import type { StoreValueReader } from './store-value-reader';

/**
 * Safe provider metadata plus a factory for context-owned connection leases.
 *
 * Implementations must not expose connection strings or credentials.
 */
export interface DatabaseDataSource {
    /** Stable provider identifier used in diagnostics and validation. */
    readonly providerName: string;
    /** SQL rendering rules for runtime queries and writes. */
    readonly dialect: SqlDialect;
    /** SQL rendering rules for migrations. */
    readonly migrationDialect: MigrationSqlDialect;
    /** Create a migration builder bound to this provider's capabilities. */
    readonly createMigrationBuilder: MigrationBuilderFactory;
    /** Convert provider values into modeled JavaScript values. */
    readonly valueReader?: StoreValueReader;
    /** Lease one context-owned connection from the provider resources. */
    createConnection(): DatabaseConnection;
}

/** Provider-owned pool or connection factory wrapped by `EntityKitDataSource`. */
export interface DatabaseConnectionSource {
    /** Create or lease one database connection. */
    createConnection(): DatabaseConnection;
    /** Close the underlying pool or resource owner. */
    dispose?(): Promise<void>;
}
