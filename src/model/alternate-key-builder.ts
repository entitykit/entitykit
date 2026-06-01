import type { MutableAlternateKeyMetadata } from './alternate-key-metadata';
import type { AlternateKeyBuilder } from './index-builder-types';

export class AlternateKeyBuilderImplementation<TEntity extends object>
implements AlternateKeyBuilder {
    constructor(
        private readonly metadata: MutableAlternateKeyMetadata<TEntity>,
    ) {}

    public hasDatabaseName(databaseName: string): this {
        this.metadata.databaseName = databaseName;
        return this;
    }
}
