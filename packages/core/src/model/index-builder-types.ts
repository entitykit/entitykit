import type { PropertyListSelector } from './model-property-selector';

/** Configures a database index for an entity. */
export interface IndexBuilder<TEntity extends object> {
    /** Require the indexed key to be unique. */ isUnique(): this;
    /** Override the generated database index name. */ hasDatabaseName(databaseName: string): this;
    /** Add non-key columns stored by a covering index. */ includeProperties(selector: PropertyListSelector<TEntity>): this;
    /** Add a provider-supported partial-index predicate. */ hasFilter(sql: string): this;
}

/** Configures an alternate key for an entity. */
export interface AlternateKeyBuilder {
    /** Configure database name and return this builder. */ hasDatabaseName(databaseName: string): this;
}
