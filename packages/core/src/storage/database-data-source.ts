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
    /** The provider name. */ readonly providerName: string;
    /** The dialect. */ readonly dialect: SqlDialect;
    /** The migration dialect. */ readonly migrationDialect: MigrationSqlDialect;
    /** The create migration builder. */ readonly createMigrationBuilder: MigrationBuilderFactory;
    /** The value reader. */ readonly valueReader?: StoreValueReader;
    /** Create connection. */ createConnection(): DatabaseConnection;
}

/** Provider-owned pool or connection factory wrapped by `EntityKitDataSource`. */
export interface DatabaseConnectionSource {
    /** Create connection. */ createConnection(): DatabaseConnection;
    /** Release resources owned by this object. */ dispose?(): Promise<void>;
}
