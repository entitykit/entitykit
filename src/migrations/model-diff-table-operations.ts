import type {
    MigrationAlterColumnDefinition,
    MigrationCheckConstraint,
    MigrationColumnDefinition,
    MigrationIndexKeyPart,
} from './migration-builder';

/** Migration operation describing create table. */ export interface CreateTableOperation {
    /** The kind. */ readonly kind: 'createTable';
    /** The entity name. */ readonly entityName: string;
    /** The table name. */ readonly tableName: string;
    /** The schema name. */ readonly schemaName?: string;
    /** The columns. */ readonly columns: readonly MigrationColumnDefinition[];
    /** The check constraints. */ readonly checkConstraints?: readonly MigrationCheckConstraint[];
}

/** Migration operation describing drop table. */ export interface DropTableOperation extends Omit<CreateTableOperation, 'kind'> {
    /** The kind. */ readonly kind: 'dropTable';
}

/** Migration operation describing rename table. */ export interface RenameTableOperation {
    /** The kind. */ readonly kind: 'renameTable';
    /** The entity name. */ readonly entityName: string;
    /** The table name. */ readonly tableName: string;
    /** The new table name. */ readonly newTableName: string;
    /** The schema name. */ readonly schemaName?: string;
}

/** Migration operation describing add column. */ export interface AddColumnOperation {
    /** The kind. */ readonly kind: 'addColumn';
    /** The entity name. */ readonly entityName: string;
    /** The table name. */ readonly tableName: string;
    /** The schema name. */ readonly schemaName?: string;
    /** The column. */ readonly column: MigrationColumnDefinition;
}

/** Migration operation describing drop column. */ export interface DropColumnOperation {
    /** The kind. */ readonly kind: 'dropColumn';
    /** The entity name. */ readonly entityName: string;
    /** The table name. */ readonly tableName: string;
    /** The schema name. */ readonly schemaName?: string;
    /** The column name. */ readonly columnName: string;
    /** The previous definition, used to reconstruct the column in `down()`. */
    readonly column: MigrationColumnDefinition;
}

/** Migration operation describing alter column. */ export interface AlterColumnOperation {
    /** The kind. */ readonly kind: 'alterColumn';
    /** The entity name. */ readonly entityName: string;
    /** The table name. */ readonly tableName: string;
    /** The schema name. */ readonly schemaName?: string;
    /** The column. */ readonly column: MigrationAlterColumnDefinition;
}

/** Migration operation describing create index. */ export interface CreateIndexOperation {
    /** The kind. */ readonly kind: 'createIndex';
    /** The entity name. */ readonly entityName: string;
    /** The table name. */ readonly tableName: string;
    /** The schema name. */ readonly schemaName?: string;
    /** Stable name for this contract or database object. */ readonly name: string;
    /** The columns. */ readonly columns: readonly string[];
    /** The key parts. */ readonly keyParts?: readonly MigrationIndexKeyPart[];
    /** The included columns. */ readonly includedColumns?: readonly string[];
    /** The filter. */ readonly filter?: string;
    /** The unique. */ readonly unique: boolean;
}

/** Migration operation describing drop index. */ export interface DropIndexOperation extends Omit<CreateIndexOperation, 'kind'> {
    /** The kind. */ readonly kind: 'dropIndex';
}
