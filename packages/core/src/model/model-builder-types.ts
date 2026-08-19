import type { EntityConstructor } from '../types';
import type { EntityBuilder } from './entity-builder-types';
import type { EntityTypeConfiguration } from './entity-type-configuration';
import type { SequenceBuilder } from './sequence-builder-types';

/** Application-facing model configuration supplied to `DbContext.model`. */
export interface ModelBuilder {
    /** Perform the entity operation. */ entity<TEntity extends object>(
        ctor: EntityConstructor<TEntity>,
        configure: (builder: EntityBuilder<TEntity>) => void,
    ): this;
    /** Perform the apply configuration operation. */ applyConfiguration<TEntity extends object>(
        configuration: EntityTypeConfiguration<TEntity>,
    ): this;
    /** Configure sequence and return this builder. */ hasSequence(
        name: string,
        configure?: (builder: SequenceBuilder) => void,
    ): this;
}
