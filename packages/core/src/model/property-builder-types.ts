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
    /** Configure default value and return this builder. */ hasDefaultValue(value: unknown): this;
    /** Configure default sql and return this builder. */ hasDefaultSql(sql: string): this;
    /** Configure computed column sql and return this builder. */ hasComputedColumnSql(sql: string, stored?: boolean): this;
    /** Configure collation and return this builder. */ useCollation(name: string): this;
    /** Configure concurrency token and return this builder. */ isConcurrencyToken(): this;
    /** Configure version and return this builder. */ isVersion(): this;
    /** Perform the value generated on add operation. */ valueGeneratedOnAdd(): this;
    /** Perform the value generated on add or update operation. */ valueGeneratedOnAddOrUpdate(): this;
    /** Perform the value generated never operation. */ valueGeneratedNever(): this;
    /** Configure identity column and return this builder. */ useIdentityColumn(options?: IdentityColumnOptions): this;
    /** Configure auto increment and return this builder. */ useAutoIncrement(): this;
    /** Configure sqlite row id and return this builder. */ useSqliteRowId(options?: RowIdColumnOptions): this;
    /** Configure sequence and return this builder. */ useSequence(name: string, schemaName?: string): this;
    /** Configure conversion and return this builder. */ hasConversion<TProvider>(
        converter: ValueConverter<TProperty, TProvider>,
    ): this;
    /** The property name. */ readonly propertyName: string;
}
