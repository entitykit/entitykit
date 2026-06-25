import type { DatabaseSchemaIntrospectionOptions, DatabaseSchemaSnapshot } from '../introspection/database-schema';
import type { MigrationBuilderFactory } from '../migrations/migration-builder-contract';
import type { MigrationSqlDialect } from '../migrations/migration-sql-dialect';
import type { SqlDialect } from '../sql/sql-dialect';
import type { DatabaseConnection } from './database-connection';
import type { DatabaseConnectionSource } from './database-data-source';
import type { StoreValueReader } from './store-value-reader';

/** Public contract for database schema introspector. */ export interface DatabaseSchemaIntrospector {
    /** Perform the introspect operation. */ introspect(options?: DatabaseSchemaIntrospectionOptions): Promise<DatabaseSchemaSnapshot>;
}

/** Configuration for database provider connection. */ export type DatabaseProviderConnectionConfig<
    TConfig extends object = Record<string, unknown>,
> = string | TConfig;

/** Runtime services required to configure a context. */
export interface DatabaseRuntimeProviderServices<
    TConfig extends object = object,
> {
    /** Stable name for this contract or database object. */ readonly name: string;
    /** The dialect. */ readonly dialect: SqlDialect;
    /** The migration dialect. */ readonly migrationDialect: MigrationSqlDialect;
    /** The create migration builder. */ readonly createMigrationBuilder: MigrationBuilderFactory;
    /**
   * Read-side value mapping for drivers that return raw storage values.
   * Omit when the driver already returns JavaScript values (as `pg` does).
   */
    readonly valueReader?: StoreValueReader;
    /** Create connection. */ createConnection(config: DatabaseProviderConnectionConfig<TConfig>): DatabaseConnection;
    /** Classify an error for explicit whole-operation retries. */
    isTransientError?(error: unknown): boolean;
}

/** Complete custom-provider SPI, including tooling and pooling hooks. */
export interface DatabaseProviderServices<
    TConfig extends object = object,
> extends DatabaseRuntimeProviderServices<TConfig> {
    /**
     * Create an application-scoped connection source. Pooled providers should
     * share one pool across the cheap connections returned by this source.
     */
    createDataSource?(config: DatabaseProviderConnectionConfig<TConfig>): DatabaseConnectionSource;
    /** Create schema introspector. */ createSchemaIntrospector?(connection: DatabaseConnection): DatabaseSchemaIntrospector;
}
