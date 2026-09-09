import type { IdentityColumnOptions, RowIdColumnOptions } from './store-generation';
import type { ValueConverter } from './value-converter/converter';

/** Configures how an entity property maps to a database column. */
export interface PropertyBuilder<TProperty = unknown> {
    /** Override the conventional database column name. */ hasColumnName(columnName: string): this;
    /** Set the provider-specific database column type. */ hasColumnType(columnType: string): this;
    /** Map the property to a non-nullable column. */ isRequired(): this;
    /** Map the property to a nullable column. */ isOptional(): this;
    /** Require values in this column to be unique. */ isUnique(): this;
    /** Set the maximum string or binary length. */ hasMaxLength(length: number): this;
    /** Set the mapped column's literal default and return this builder. Does not execute SQL. */ hasDefaultValue(value: unknown): this;
    /** Declare a database default expression in the mapping. Does not execute SQL. */ hasDefaultSql(sql: string): this;
    /** Configure a database-computed column and whether it is stored; marks values generated on insert and update. */ hasComputedColumnSql(sql: string, stored?: boolean): this;
    /** Set the provider-specific column collation. Does not execute SQL. */ useCollation(name: string): this;
    /** Compare the accepted value during tracked updates and deletes to detect optimistic concurrency conflicts. */ isConcurrencyToken(): this;
    /** Configure an EntityKit-managed numeric concurrency version. */ isVersion(): this;
    /** Read a store-generated value after insertion. */ valueGeneratedOnAdd(): this;
    /** Read store-generated values after insertion and updates. */ valueGeneratedOnAddOrUpdate(): this;
    /** Persist application-supplied values instead of treating them as store-generated. */ valueGeneratedNever(): this;
    /** Configure a provider-supported identity column, generated on insertion. */ useIdentityColumn(options?: IdentityColumnOptions): this;
    /** Configure a provider-supported auto-increment column. */ useAutoIncrement(): this;
    /** Configure a SQLite integer rowid-backed column. */ useSqliteRowId(options?: RowIdColumnOptions): this;
    /** Generate inserted values from the named database sequence. */ useSequence(name: string, schemaName?: string): this;
    /** Convert between model and provider values synchronously during reads and writes. */ hasConversion<TProvider>(
        converter: ValueConverter<TProperty, TProvider>,
    ): this;
    /** The property name. */ readonly propertyName: string;
}
