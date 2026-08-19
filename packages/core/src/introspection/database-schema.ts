import type { StoreGenerationStrategy } from '../model/store-generation';

/** Options that configure database schema introspection. */ export interface DatabaseSchemaIntrospectionOptions {
    /** The schemas. */ readonly schemas?: readonly string[];
}

/** Serializable snapshot of database schema. */ export interface DatabaseSchemaSnapshot {
    /** The schemas. */ readonly schemas: readonly DatabaseSchema[];
}

/** Public contract for database schema. */ export interface DatabaseSchema {
    /** Stable name for this contract or database object. */ readonly name: string;
    /** The tables. */ readonly tables: readonly DatabaseTable[];
    /** The sequences. */ readonly sequences?: readonly DatabaseSequence[];
}

/** Public contract for database table. */ export interface DatabaseTable {
    /** The schema name. */ readonly schemaName: string;
    /** The table name. */ readonly tableName: string;
    /** Tables are migration-managed; views are scaffolded as read-only mappings. */
    readonly objectType?: 'table' | 'view';
    /** The columns. */ readonly columns: readonly DatabaseColumn[];
    /** The primary key. */ readonly primaryKey?: DatabasePrimaryKey;
    /** The indexes. */ readonly indexes: readonly DatabaseIndex[];
    /** The foreign keys. */ readonly foreignKeys: readonly DatabaseForeignKey[];
    /** The check constraints. */ readonly checkConstraints?: readonly DatabaseCheckConstraint[];
}

/** Public contract for database column. */ export interface DatabaseColumn {
    /** Stable name for this contract or database object. */ readonly name: string;
    /** The ordinal. */ readonly ordinal: number;
    /** The store type. */ readonly storeType: string;
    /** Whether nullable. */ readonly isNullable: boolean;
    /** The default sql. */ readonly defaultSql?: string;
    /** The server assigns this value on insert (identity, serial, auto-increment, or rowid). */
    readonly isStoreGenerated?: boolean;
    /** Lossless provider store-generation semantics when the database exposes them. */
    readonly storeGeneration?: StoreGenerationStrategy;
    /** Provider collation when it materially affects regenerated text semantics. */
    readonly collation?: string;
    /** The generated expression. */ readonly generatedExpression?: string;
    /** The generated stored. */ readonly generatedStored?: boolean;
}

/** Public contract for database primary key. */ export interface DatabasePrimaryKey {
    /** Stable name for this contract or database object. */ readonly name: string;
    /** The columns. */ readonly columns: readonly string[];
}

/** Public contract for database index. */ export interface DatabaseIndex {
    /** Stable name for this contract or database object. */ readonly name: string;
    /** The columns. */ readonly columns: readonly string[];
    /** Whether unique. */ readonly isUnique: boolean;
    /** Ordered key terms; absent for legacy column-only snapshots. */
    readonly keyParts?: readonly DatabaseIndexKeyPart[];
    /** The included columns. */ readonly includedColumns?: readonly string[];
    /** The filter. */ readonly filter?: string;
    /** Provider features the neutral EntityKit index model cannot reproduce. */
    readonly unsupportedFeatures?: readonly string[];
}

/** Public type representing database index key part. */ export type DatabaseIndexKeyPart =
    | {
        /** Discriminator for a named index column. */
        readonly kind: 'column';
        /** Database column name. */
        readonly name: string;
    }
    | {
        /** Discriminator for a SQL index expression. */
        readonly kind: 'expression';
        /** SQL expression used as an index key. */
        readonly expression: string;
    };

/** Public contract for database check constraint. */ export interface DatabaseCheckConstraint {
    /** Stable name for this contract or database object. */ readonly name: string;
    /** The sql. */ readonly sql: string;
}

/** Public contract for database sequence. */ export interface DatabaseSequence {
    /** Stable name for this contract or database object. */ readonly name: string;
    /** The schema name. */ readonly schemaName: string;
    /** The data type. */ readonly dataType?: 'smallint' | 'integer' | 'bigint';
    /** The start value. */ readonly startValue?: string;
    /** The increment by. */ readonly incrementBy?: string;
    /** The min value. */ readonly minValue?: string;
    /** The max value. */ readonly maxValue?: string;
    /** Whether cyclic. */ readonly isCyclic: boolean;
    /** The cache. */ readonly cache?: number;
}

/** Public contract for database foreign key. */ export interface DatabaseForeignKey {
    /** Stable name for this contract or database object. */ readonly name: string;
    /** The columns. */ readonly columns: readonly string[];
    /** The principal schema name. */ readonly principalSchemaName: string;
    /** The principal table name. */ readonly principalTableName: string;
    /** The principal columns. */ readonly principalColumns: readonly string[];
    /** The on delete. */ readonly onDelete: string;
}
