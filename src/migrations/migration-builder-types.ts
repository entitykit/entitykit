import type { SqlStatement } from '../sql/sql-statement';
import type { MigrationCheckConstraint } from './migration-builder-schema-types';
import type { StoreGenerationStrategy } from '../model/store-generation';
export type { MigrationIndexDefinition, MigrationIndexKeyPart } from './migration-index-types';
export type {
    MigrationCheckConstraint,
    MigrationSequenceDefinition,
    MigrationTableCopyColumn,
    MigrationTableRebuildDefinition,
    MigrationTableShape,
} from './migration-builder-schema-types';
/**
 * WHY: Data-only declarations for the migration builder family. Kept in a
 * dependency-free leaf module so the composing `MigrationBuilder`, its core, and
 * every operation module can import the shapes they exchange without pulling in
 * (or cycling through) each other's runtime code.
 */

export interface MigrationStatement extends SqlStatement {
    /** The suppress transaction. */ readonly suppressTransaction?: boolean;
}

/** Public contract for migration column definition. */ export interface MigrationColumnDefinition {
    /** Stable name for this contract or database object. */ readonly name: string;
    /** The type. */ readonly type: string;
    /** The nullable. */ readonly nullable?: boolean;
    /** The primary key. */ readonly primaryKey?: boolean;
    /** The default sql. */ readonly defaultSql?: string;
    /** The computed sql. */ readonly computedSql?: string;
    /** The computed stored. */ readonly computedStored?: boolean;
    /** The collation. */ readonly collation?: string;
    /** The store generation. */ readonly storeGeneration?: StoreGenerationStrategy;
}

/** Public contract for migration foreign key definition. */ export interface MigrationForeignKeyDefinition {
    /** Stable name for this contract or database object. */ readonly name: string;
    /** The table name. */ readonly tableName: string;
    /** The schema name. */ readonly schemaName?: string;
    /** The columns. */ readonly columns: readonly string[];
    /** The principal table name. */ readonly principalTableName: string;
    /** The principal schema name. */ readonly principalSchemaName?: string;
    /** The principal columns. */ readonly principalColumns: readonly string[];
    /** The on delete. */ readonly onDelete?: string;
}

/** Public contract for migration alter column definition. */ export interface MigrationAlterColumnDefinition extends MigrationColumnDefinition {
    /** The old name. */ readonly oldName?: string;
    /** The old type. */ readonly oldType?: string;
    /** The old nullable. */ readonly oldNullable?: boolean;
    /** The old default sql. */ readonly oldDefaultSql?: string;
    /** The old computed sql. */ readonly oldComputedSql?: string;
    /** The old computed stored. */ readonly oldComputedStored?: boolean;
    /** The old collation. */ readonly oldCollation?: string;
    /** The old store generation. */ readonly oldStoreGeneration?: StoreGenerationStrategy;
}

/** Options that configure migration sql. */ export interface MigrationSqlOptions {
    /** The suppress transaction. */ readonly suppressTransaction?: boolean;
}

/** Options that configure migration drop index. */ export interface MigrationDropIndexOptions {
    /** The concurrently. */ readonly concurrently?: boolean;
    /**
   * The index's table. Optional for Postgres and SQLite, which drop an index by
   * name; required for MySQL, whose `drop index ... on <table>` needs it.
   */
    readonly tableName?: string;
}

/** Options that configure migration builder. */ export interface MigrationBuilderOptions {
    /** The provider name. */ readonly providerName?: string;
    /**
   * Whether provider DDL participates in transaction rollback. MySQL DDL
   * implicitly commits, so its builder marks generated DDL as transaction
   * suppressed while leaving raw data statements transactional by default.
   */
    readonly supportsTransactionalDdl?: boolean;
    /** Whether extensions. */ readonly supportsExtensions?: boolean;
    /** Whether concurrent indexes. */ readonly supportsConcurrentIndexes?: boolean;
    /**
   * Whether the provider can add or drop table constraints with
   * `alter table`. SQLite cannot: constraints may only be declared when the
   * table is created.
   */
    readonly supportsAlterTableConstraints?: boolean;
    /**
   * Whether the provider can change a column's type or nullability in place.
   * SQLite cannot alter an existing column (only rename, add, or drop).
   */
    readonly supportsColumnAlteration?: boolean;
    /**
   * Whether the provider can rename an index with the `renameIndex` API.
   * MySQL renames an index only through `alter table ... rename index`, which
   * needs the table name this API does not carry; SQLite has no index rename
   * (drop and recreate instead).
   */
    readonly supportsRenameIndex?: boolean;
}

/** A foreign key declared as part of `create table`. */
export interface MigrationTableForeignKey {
    /** Stable name for this contract or database object. */ readonly name: string;
    /** The columns. */ readonly columns: readonly string[];
    /** The principal table name. */ readonly principalTableName: string;
    /** The principal schema name. */ readonly principalSchemaName?: string;
    /** The principal columns. */ readonly principalColumns: readonly string[];
    /** The on delete. */ readonly onDelete?: string;
}

/** Options that configure migration create table. */ export interface MigrationCreateTableOptions {
    /** Optional database name for the primary-key constraint. */
    readonly primaryKeyName?: string;
    /** Inline foreign keys, required by providers that cannot add constraints. */
    readonly foreignKeys?: readonly MigrationTableForeignKey[];
    /** The check constraints. */ readonly checkConstraints?: readonly MigrationCheckConstraint[];
}

/**
 * Mutable twin of {@link MigrationColumnDefinition} used internally by the
 * fluent table/column builders while a definition is still being assembled.
 * Not part of the public surface.
 */
export interface MutableMigrationColumnDefinition {
    /** Stable name for this contract or database object. */ name: string;
    /** The type. */ type: string;
    /** The nullable. */ nullable?: boolean;
    /** The primary key. */ primaryKey?: boolean;
    /** The default sql. */ defaultSql?: string;
    /** The computed sql. */ computedSql?: string;
    /** The computed stored. */ computedStored?: boolean;
    /** The collation. */ collation?: string;
    /** The store generation. */ storeGeneration?: StoreGenerationStrategy;
}
