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
import { assertSynchronousCallbackResult } from '../synchronous-callback';

/**
 * Collects fluent entity configuration before a `DbContext` model is finalized.
 */
export class ModelBuilder {
    private readonly entityBuilders: Map<
        EntityConstructor<object>,
        EntityBuilderImplementation<object>
    > = new Map();
    private readonly sequenceBuilders: SequenceBuilderImplementation[] = [];
    private validationFailure?: ModelValidationError;

    /**
   * Configure one entity type.
   */
    public entity<TEntity extends object>(
        ctor: EntityConstructor<TEntity>,
        configure: (builder: EntityBuilder<TEntity>) => void,
    ): this {
        this.assertValid();
        const builder = this.getOrCreateEntityBuilder(ctor);
        try {
            // The public void contract hides values that JavaScript still returns.
            // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
            const result: unknown = configure(builder);
            assertSynchronousCallbackResult(
                result,
                `ModelBuilder.entity(${ctor.name}) callback`,
                message => new ModelValidationError(message, {
                    entityName: ctor.name,
                    contractViolation: 'asyncEntityConfiguration',
                }),
            );
        } catch (error) {
            throw this.recordFailure(error);
        }
        return this;
    }

    /**
   * Apply a reusable entity configuration object.
   */
    public applyConfiguration<TEntity extends object>(configuration: EntityTypeConfiguration<TEntity>): this {
        return this.entity(configuration.entity, builder => {
            // Preserve the runtime value for entity() to validate.
            // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression
            return configuration.configure(builder);
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
        this.assertValid();
        if (!name.trim()) {
            throw new ModelValidationError('Sequence name must not be empty.');
        }
        const builder = new SequenceBuilderImplementation({ name: name.trim() });
        try {
            // The public void contract hides values that JavaScript still returns.
            const result: unknown = configure?.(builder);
            assertSynchronousCallbackResult(
                result,
                `ModelBuilder.hasSequence(${name.trim()}) callback`,
                message => new ModelValidationError(message, {
                    sequenceName: name.trim(),
                    contractViolation: 'asyncSequenceConfiguration',
                }),
            );
        } catch (error) {
            throw this.recordFailure(error);
        }
        this.sequenceBuilders.push(builder);
        return this;
    }

    public build(): Model {
        this.assertValid();
        try {
            const entities = Array.from(this.entityBuilders.values()).map(
                builder => builder.build(),
            );
            return new Model(
                entities,
                this.sequenceBuilders.map(builder => builder.build()),
            );
        } catch (error) {
            throw this.recordFailure(error);
        }
    }

    private assertValid(): void {
        if (this.validationFailure) {
            throw this.validationFailure;
        }
    }

    private recordFailure(error: unknown): ModelValidationError {
        const failure = asModelValidationError(error);
        this.validationFailure ??= failure;
        return failure;
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
