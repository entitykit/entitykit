/** One column or SQL expression in a migration index key. */
export type MigrationIndexKeyPart =
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

/** Complete migration-time definition of a database index. */
export interface MigrationIndexDefinition {
    /** Database index name. */ readonly name: string;
    /** Database table name. */ readonly tableName: string;
    /** Optional database schema name. */ readonly schemaName?: string;
    /** Legacy column-only index keys. */ readonly columns: readonly string[];
    /** Ordered column or expression index keys. */ readonly keyParts?: readonly MigrationIndexKeyPart[];
    /** Non-key columns stored with the index. */ readonly includedColumns?: readonly string[];
    /** SQL predicate for a partial index. */ readonly filter?: string;
    /** Whether the index enforces uniqueness. */ readonly unique?: boolean;
    /** Whether Postgres should build the index concurrently. */ readonly concurrently?: boolean;
}
