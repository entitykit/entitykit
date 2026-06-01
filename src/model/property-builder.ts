import { assertSupportedDefaultValue } from './default-value';
import type { MutablePropertyMetadata } from './property-metadata';
import type { ValueConverter } from './value-converter/converter';
import { ValueGenerated } from './value-generated';
import type { IdentityColumnOptions, RowIdColumnOptions } from './store-generation';
import { configureAutoIncrement, configureIdentity, configureRowId, configureSequence } from './property-store-generation';
import { requireNonEmpty } from './require-non-empty';
import type { PropertyBuilder } from './property-builder-types';

export class PropertyBuilderImplementation<
    TEntity extends object,
    TProperty = unknown,
> implements PropertyBuilder<TProperty> {
    constructor(private readonly metadata: MutablePropertyMetadata<TEntity, TProperty>) {}
    public hasColumnName(columnName: string): this {
        this.metadata.columnName = columnName;
        return this;
    }
    public hasColumnType(columnType: string): this {
        this.metadata.columnType = columnType;
        return this;
    }
    public isRequired(): this {
        this.metadata.isRequired = true;
        return this;
    }
    public isOptional(): this {
        this.metadata.isRequired = false;
        return this;
    }
    public isUnique(): this {
        this.metadata.isUnique = true;
        return this;
    }
    public hasMaxLength(length: number): this {
        if (!Number.isInteger(length) || length <= 0) {
            throw new Error('hasMaxLength requires a positive integer.');
        }
        this.metadata.maxLength = length;
        return this;
    }
    public hasDefaultValue(value: unknown): this {
        assertSupportedDefaultValue(value);
        this.metadata.defaultValue = value;
        return this;
    }
    public hasDefaultSql(sql: string): this {
        this.metadata.defaultSql = sql;
        return this;
    }
    public hasComputedColumnSql(sql: string, stored = true): this {
        this.metadata.computedSql = requireNonEmpty(sql, 'hasComputedColumnSql');
        this.metadata.computedStored = stored;
        this.metadata.valueGenerated = ValueGenerated.OnAddOrUpdate;
        return this;
    }
    public useCollation(name: string): this {
        this.metadata.collation = requireNonEmpty(name, 'useCollation');
        return this;
    }
    public isConcurrencyToken(): this {
        this.metadata.isConcurrencyToken = true;
        return this;
    }
    public isVersion(): this {
        this.metadata.isConcurrencyToken = true;
        this.metadata.isVersion = true;
        return this;
    }
    public valueGeneratedOnAdd(): this {
        this.metadata.valueGenerated = ValueGenerated.OnAdd;
        return this;
    }
    public valueGeneratedOnAddOrUpdate(): this {
        this.metadata.valueGenerated = ValueGenerated.OnAddOrUpdate;
        return this;
    }
    public valueGeneratedNever(): this {
        this.metadata.valueGenerated = ValueGenerated.Never;
        return this;
    }
    public useIdentityColumn(options: IdentityColumnOptions = {}): this {
        configureIdentity(this.metadata, options);
        return this.valueGeneratedOnAdd();
    }
    public useAutoIncrement(): this {
        configureAutoIncrement(this.metadata);
        return this.valueGeneratedOnAdd();
    }
    public useSqliteRowId(options: RowIdColumnOptions = {}): this {
        configureRowId(this.metadata, options);
        return this.valueGeneratedOnAdd();
    }
    public useSequence(name: string, schemaName?: string): this {
        configureSequence(this.metadata, name, schemaName);
        return this.valueGeneratedOnAdd();
    }
    public hasConversion<TProvider>(converter: ValueConverter<TProperty, TProvider>): this {
        this.metadata.converter = converter;
        return this;
    }
    public get propertyName(): string {
        return this.metadata.propertyName;
    }
}
