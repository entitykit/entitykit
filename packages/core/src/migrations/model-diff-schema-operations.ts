import type {
    MigrationColumnDefinition,
    MigrationSequenceDefinition,
    MigrationTableRebuildDefinition,
} from './migration-builder';

/** Fields shared by add/drop foreign-key diff operations. */
export interface ForeignKeyOperation {
    /** The entity name. */ readonly entityName: string;
    /** The table name. */ readonly tableName: string;
    /** The schema name. */ readonly schemaName?: string;
    /** Stable name for this contract or database object. */ readonly name: string;
    /** The columns. */ readonly columns: readonly string[];
    /** The principal table name. */ readonly principalTableName: string;
    /** The principal schema name. */ readonly principalSchemaName?: string;
    /** The principal columns. */ readonly principalColumns: readonly string[];
    /** The on delete. */ readonly onDelete: string;
}

/** Migration operation that adds a foreign-key constraint. */
export interface AddForeignKeyOperation extends ForeignKeyOperation {
    /** The kind. */ readonly kind: 'addForeignKey';
}

/** Migration operation that removes a foreign-key constraint. */
export interface DropForeignKeyOperation extends ForeignKeyOperation {
    /** The kind. */ readonly kind: 'dropForeignKey';
}

/** Migration operation describing add check constraint. */ export interface AddCheckConstraintOperation {
    /** The kind. */ readonly kind: 'addCheckConstraint';
    /** The entity name. */ readonly entityName: string;
    /** The table name. */ readonly tableName: string;
    /** The schema name. */ readonly schemaName?: string;
    /** Stable name for this contract or database object. */ readonly name: string;
    /** The sql. */ readonly sql: string;
}

/** Migration operation describing drop check constraint. */ export interface DropCheckConstraintOperation extends Omit<AddCheckConstraintOperation, 'kind'> {
    /** The kind. */ readonly kind: 'dropCheckConstraint';
}

/** Migration operation describing create sequence. */ export interface CreateSequenceOperation {
    /** The kind. */ readonly kind: 'createSequence';
    /** The sequence. */ readonly sequence: MigrationSequenceDefinition;
}

/** Migration operation describing alter sequence. */ export interface AlterSequenceOperation {
    /** The kind. */ readonly kind: 'alterSequence';
    /** The sequence. */ readonly sequence: MigrationSequenceDefinition;
    /** The previous. */ readonly previous: MigrationSequenceDefinition;
}

/** Migration operation describing drop sequence. */ export interface DropSequenceOperation {
    /** The kind. */ readonly kind: 'dropSequence';
    /** The sequence. */ readonly sequence: MigrationSequenceDefinition;
}

/** Migration operation describing rebuild table. */ export interface RebuildTableOperation {
    /** The kind. */ readonly kind: 'rebuildTable';
    /** The entity name. */ readonly entityName: string;
    /** The table name. */ readonly tableName: string;
    /** The schema name. */ readonly schemaName?: string;
    /** The definition. */ readonly definition: MigrationTableRebuildDefinition;
}

/** Migration operation describing create join table. */ export interface CreateJoinTableOperation {
    /** The kind. */ readonly kind: 'createJoinTable';
    /** The entity name. */ readonly entityName: string;
    /** The table name. */ readonly tableName: string;
    /** The schema name. */ readonly schemaName?: string;
    /** The columns. */ readonly columns: readonly MigrationColumnDefinition[];
    /** The primary key name. */ readonly primaryKeyName: string;
    /** The primary key columns. */ readonly primaryKeyColumns: readonly string[];
    /** The source table name. */ readonly sourceTableName: string;
    /** The source schema name. */ readonly sourceSchemaName?: string;
    /** Principal columns in key order. */
    readonly sourceColumnNames?: readonly string[];
    /** Join columns ordered to match sourceColumnNames. */
    readonly sourceForeignKeyColumns?: readonly string[];
    /**
     * First source column retained for legacy snapshot compatibility.
     * @deprecated Use `sourceColumnNames`.
     */
    readonly sourceColumnName: string;
    /**
     * First source foreign-key column retained for legacy snapshots.
     * @deprecated Use `sourceForeignKeyColumns`.
     */
    readonly sourceForeignKeyColumn: string;
    /** The source constraint name. */ readonly sourceConstraintName: string;
    /** The target table name. */ readonly targetTableName: string;
    /** The target schema name. */ readonly targetSchemaName?: string;
    /** Principal columns in key order. */
    readonly targetColumnNames?: readonly string[];
    /** Join columns ordered to match targetColumnNames. */
    readonly targetForeignKeyColumns?: readonly string[];
    /**
     * First target column retained for legacy snapshot compatibility.
     * @deprecated Use `targetColumnNames`.
     */
    readonly targetColumnName: string;
    /**
     * First target foreign-key column retained for legacy snapshots.
     * @deprecated Use `targetForeignKeyColumns`.
     */
    readonly targetForeignKeyColumn: string;
    /** The target constraint name. */ readonly targetConstraintName: string;
    /** The delete behavior. */ readonly deleteBehavior: string;
}

/** Migration operation describing drop join table. */ export interface DropJoinTableOperation extends Omit<CreateJoinTableOperation, 'kind'> {
    /** The kind. */ readonly kind: 'dropJoinTable';
}
