import type { StoreGenerationStrategy } from './store-generation';

/** Serializable snapshot of model. */ export interface ModelSnapshot {
    /** The format version. */ readonly formatVersion: 1;
    /** The entities. */ readonly entities: readonly EntitySnapshot[];
    /** The sequences. */ readonly sequences?: readonly SequenceSnapshot[];
}

/** Serializable snapshot of entity. */ export interface EntitySnapshot {
    /** The entity name. */ readonly entityName: string;
    /** The table name. */ readonly tableName: string;
    /** The schema name. */ readonly schemaName?: string;
    /** Whether keyless. */ readonly isKeyless?: boolean;
    /** Whether view. */ readonly isView?: boolean;
    /** Legacy single-key field; written only when the key has one property. */
    readonly keyProperty?: string;
    /** Key property names in declaration order. Absent in older snapshots. */
    readonly keyProperties?: readonly string[];
    /** Alternate unique tuples that relationships may target. */
    readonly alternateKeys?: readonly AlternateKeySnapshot[];
    /** The check constraints. */ readonly checkConstraints?: readonly CheckConstraintSnapshot[];
    /** The properties. */ readonly properties: readonly PropertySnapshot[];
    /** The ignored properties. */ readonly ignoredProperties: readonly string[];
    /** The indexes. */ readonly indexes: readonly IndexSnapshot[];
    /** The relationships. */ readonly relationships: readonly RelationshipSnapshot[];
    /** The many to many relationships. */ readonly manyToManyRelationships?: readonly ManyToManySnapshot[];
    /** The audit. */ readonly audit?: AuditSnapshot;
    /** The soft delete. */ readonly softDelete?: SoftDeleteSnapshot;
    /** The tenant key property. */ readonly tenantKeyProperty?: string;
}

/** Serializable snapshot of audit. */ export interface AuditSnapshot {
    /** The created at property. */ readonly createdAtProperty?: string;
    /** The updated at property. */ readonly updatedAtProperty?: string;
    /** The created by property. */ readonly createdByProperty?: string;
    /** The updated by property. */ readonly updatedByProperty?: string;
}

/** Serializable snapshot of soft delete. */ export interface SoftDeleteSnapshot {
    /** The property name. */ readonly propertyName: string;
    /** The deleted value. */ readonly deletedValue?: unknown;
}

/** Serializable snapshot of property. */ export interface PropertySnapshot {
    /** The property name. */ readonly propertyName: string;
    /** The column name. */ readonly columnName: string;
    /** The column type. */ readonly columnType: string;
    /** Whether required. */ readonly isRequired: boolean;
    /** Whether primary key. */ readonly isPrimaryKey: boolean;
    /** Whether unique. */ readonly isUnique: boolean;
    /** The max length. */ readonly maxLength?: number;
    /** The default value. */ readonly defaultValue?: unknown;
    /** The default sql. */ readonly defaultSql?: string;
    /** The computed sql. */ readonly computedSql?: string;
    /** The computed stored. */ readonly computedStored?: boolean;
    /** The collation. */ readonly collation?: string;
    /** The store generation. */ readonly storeGeneration?: StoreGenerationStrategy;
    /** Whether converter. */ readonly hasConverter: boolean;
    /** Whether concurrency token. */ readonly isConcurrencyToken: boolean;
    /** Whether version. */ readonly isVersion: boolean;
    /** Absent in snapshots written before database-generated values shipped. */
    readonly valueGenerated?: 'never' | 'onAdd' | 'onAddOrUpdate';
}

/** Serializable snapshot of index. */ export interface IndexSnapshot {
    /** The property names. */ readonly propertyNames: readonly string[];
    /** Ordered key terms; absent in legacy property-only snapshots. */
    readonly keyParts?: readonly IndexKeyPartSnapshot[];
    /** The included property names. */ readonly includedPropertyNames?: readonly string[];
    /** The filter. */ readonly filter?: string;
    /** Whether unique. */ readonly isUnique: boolean;
    /** The database name. */ readonly databaseName?: string;
}

/** Serializable snapshot of index key part. */ export type IndexKeyPartSnapshot =
    | {
        /** Discriminator for a mapped property index key. */
        readonly kind: 'property';
        /** Mapped property name. */
        readonly propertyName: string;
    }
    | {
        /** Discriminator for a SQL index expression. */
        readonly kind: 'expression';
        /** SQL expression used as an index key. */
        readonly expression: string;
    };

/** Serializable snapshot of check constraint. */ export interface CheckConstraintSnapshot {
    /** Stable name for this contract or database object. */ readonly name: string;
    /** The sql. */ readonly sql: string;
}

/** Serializable snapshot of sequence. */ export interface SequenceSnapshot {
    /** Stable name for this contract or database object. */ readonly name: string;
    /** The schema name. */ readonly schemaName?: string;
    /** The data type. */ readonly dataType?: 'smallint' | 'integer' | 'bigint';
    /** The start value. */ readonly startValue?: string;
    /** The increment by. */ readonly incrementBy?: string;
    /** The min value. */ readonly minValue?: string;
    /** The max value. */ readonly maxValue?: string;
    /** Whether cyclic. */ readonly isCyclic: boolean;
    /** The cache. */ readonly cache?: number;
}

/** Serializable snapshot of alternate key. */ export interface AlternateKeySnapshot {
    /** The property names. */ readonly propertyNames: readonly string[];
    /** The database name. */ readonly databaseName?: string;
}

/** Serializable snapshot of relationship. */ export interface RelationshipSnapshot {
    /** The navigation property. */ readonly navigationProperty: string;
    /** The principal entity name. */ readonly principalEntityName: string;
    /** The inverse navigation property. */ readonly inverseNavigationProperty?: string;
    /** Legacy single-column field; written only for one foreign-key column. */
    readonly foreignKeyProperty?: string;
    /** Foreign-key properties ordered to match the principal key. */
    readonly foreignKeyProperties?: readonly string[];
    /** Principal properties in relationship order. Absent means primary key. */
    readonly principalKeyProperties?: readonly string[];
    /** Absent in snapshots written before one-to-one cardinality shipped. */
    readonly cardinality?: 'manyToOne' | 'oneToOne';
    /** The delete behavior. */ readonly deleteBehavior: string;
    /** The constraint name. */ readonly constraintName?: string;
}

/** Serializable snapshot of many to many. */ export interface ManyToManySnapshot {
    /** The navigation property. */ readonly navigationProperty: string;
    /** The target entity name. */ readonly targetEntityName: string;
    /** The inverse navigation property. */ readonly inverseNavigationProperty?: string;
    /** The join table name. */ readonly joinTableName: string;
    /** The join schema name. */ readonly joinSchemaName?: string;
    /** The primary key name. */ readonly primaryKeyName?: string;
    /** Legacy single-column fields; written only for one key column. */
    readonly sourceForeignKeyColumn?: string;
    /** The target foreign key column. */ readonly targetForeignKeyColumn?: string;
    /** Join columns per side, ordered to match that entity's key. */
    readonly sourceForeignKeyColumns?: readonly string[];
    /** The target foreign key columns. */ readonly targetForeignKeyColumns?: readonly string[];
    /** The source constraint name. */ readonly sourceConstraintName?: string;
    /** The target constraint name. */ readonly targetConstraintName?: string;
    /** The delete behavior. */ readonly deleteBehavior: string;
}
