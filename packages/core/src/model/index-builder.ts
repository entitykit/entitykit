import type { MutableIndexMetadata } from './index-metadata';
import type { PropertyListSelector } from './model-property-selector';
import { selectPropertyNames } from './model-property-selector';
import type { IndexBuilder } from './index-builder-types';

export class IndexBuilderImplementation<TEntity extends object>
implements IndexBuilder<TEntity> {
    constructor(private readonly metadata: MutableIndexMetadata<TEntity>) {}

    public isUnique(): this {
        this.metadata.isUnique = true;
        return this;
    }

    public hasDatabaseName(databaseName: string): this {
        if (!databaseName.trim()) {
            throw new Error('Index database name must not be empty.');
        }
        this.metadata.databaseName = databaseName.trim();
        return this;
    }

    /** Add non-key columns stored in a covering index. */
    public includeProperties(selector: PropertyListSelector<TEntity>): this {
        this.metadata.includedPropertyNames = [...selectPropertyNames(selector)];
        return this;
    }

    /** Add a provider-supported partial-index predicate. */
    public hasFilter(sql: string): this {
        if (!sql.trim()) {
            throw new Error('Index filter SQL must not be empty.');
        }
        this.metadata.filter = sql.trim();
        return this;
    }

}
