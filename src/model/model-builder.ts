import type { EntityConstructor } from '../types';
import { EntityBuilderImplementation } from './entity-builder';
import type { EntityBuilder } from './entity-builder-types';
import { Model } from './model';
import type { AnyEntityTypeConfiguration, EntityTypeConfiguration } from './entity-type-configuration';
import { SequenceBuilderImplementation } from './sequence-builder';
import type { SequenceBuilder } from './sequence-builder-types';
import {
    asModelValidationError,
    ModelValidationError,
} from '../errors/model-validation-error';

/**
 * Collects fluent entity configuration before a `DbContext` model is finalized.
 */
export class ModelBuilder {
    private readonly entityBuilders: Map<
        EntityConstructor<object>,
        EntityBuilderImplementation<object>
    > = new Map();
    private readonly sequenceBuilders: SequenceBuilderImplementation[] = [];

    /**
   * Configure one entity type.
   */
    public entity<TEntity extends object>(
        ctor: EntityConstructor<TEntity>,
        configure: (builder: EntityBuilder<TEntity>) => void,
    ): this {
        const builder = this.getOrCreateEntityBuilder(ctor);
        try {
            configure(builder);
        } catch (error) {
            throw asModelValidationError(error);
        }
        return this;
    }

    /**
   * Apply a reusable entity configuration object.
   */
    public applyConfiguration<TEntity extends object>(configuration: EntityTypeConfiguration<TEntity>): this {
        return this.entity(configuration.entity, builder => {
            configuration.configure(builder);
        });
    }

    /**
   * Apply multiple reusable entity configuration objects.
   */
    public applyConfigurations(configurations: readonly AnyEntityTypeConfiguration[]): this {
        for (const configuration of configurations) {
            this.applyConfiguration(
                configuration,
            );
        }
        return this;
    }

    /** Configure a database sequence. */
    public hasSequence(
        name: string,
        configure?: (builder: SequenceBuilder) => void,
    ): this {
        if (!name.trim()) {
            throw new ModelValidationError('Sequence name must not be empty.');
        }
        const builder = new SequenceBuilderImplementation({ name: name.trim() });
        configure?.(builder);
        this.sequenceBuilders.push(builder);
        return this;
    }

    public build(): Model {
        try {
            const entities = Array.from(this.entityBuilders.values()).map(
                builder => builder.build(),
            );
            return new Model(
                entities,
                this.sequenceBuilders.map(builder => builder.build()),
            );
        } catch (error) {
            throw asModelValidationError(error);
        }
    }

    private getOrCreateEntityBuilder<TEntity extends object>(
        ctor: EntityConstructor<TEntity>,
    ): EntityBuilderImplementation<TEntity> {
        const existing = this.entityBuilders.get(ctor);
        if (existing) {
            return existing as unknown as EntityBuilderImplementation<TEntity>;
        }

        const created = new EntityBuilderImplementation(ctor);
        this.entityBuilders.set(
            ctor,
            created as unknown as EntityBuilderImplementation<object>,
        );
        return created;
    }
}
