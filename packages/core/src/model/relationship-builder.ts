import type { EntityPropertyKey } from '../types';
import type { PropertyListSelector, PropertySelector } from './model-property-selector';
import { selectPropertyName, selectPropertyNames } from './model-property-selector';
import type { DeleteBehavior } from './relationship-metadata';
import {
    type MutableRelationshipMetadata,
    RelationshipCardinality,
} from './relationship-metadata';
import type { RelationshipBuilder } from './relationship-builder-types';

export class RelationshipBuilderImplementation<
    TEntity extends object,
    TPrincipal extends object,
> implements RelationshipBuilder<TEntity, TPrincipal> {
    constructor(private readonly metadata: MutableRelationshipMetadata<TEntity, TPrincipal>) {}

    public withMany<TProperty = unknown>(selector?: PropertySelector<TPrincipal, TProperty>): this {
        this.metadata.cardinality = RelationshipCardinality.ManyToOne;
        if (selector) {
            this.metadata.inverseNavigationProperty = selectPropertyName(selector);
        }
        return this;
    }

    public withOne<TProperty = unknown>(selector?: PropertySelector<TPrincipal, TProperty>): this {
        this.metadata.cardinality = RelationshipCardinality.OneToOne;
        if (selector) {
            this.metadata.inverseNavigationProperty = selectPropertyName(selector);
        }
        return this;
    }

    /**
   * Configure the foreign key.
   *
   * Return an array when the principal has a composite key; the properties must
   * be listed in the same order as the principal's key properties.
   *
   * @example
   * ```ts
   * .hasForeignKey(item => item.orderId)
   * .hasForeignKey(item => [item.orderId, item.lineNumber])
   * ```
   */
    public hasForeignKey(propertyOrSelector: EntityPropertyKey<TEntity> | PropertyListSelector<TEntity>): this {
        const propertyNames = typeof propertyOrSelector === 'function'
            ? selectPropertyNames(propertyOrSelector)
            : [propertyOrSelector];

        const seen: Set<string> = new Set();
        for (const propertyName of propertyNames) {
            if (seen.has(propertyName)) {
                throw new Error(`Foreign key of relationship '${this.metadata.navigationProperty}' lists property '${propertyName}' more than once.`);
            }
            seen.add(propertyName);
        }

        this.metadata.foreignKeyProperties = propertyNames;
        return this;
    }

    public hasPrincipalKey(
        propertyOrSelector:
        EntityPropertyKey<TPrincipal> | PropertyListSelector<TPrincipal>,
    ): this {
        const propertyNames = typeof propertyOrSelector === 'function'
            ? selectPropertyNames(propertyOrSelector)
            : [propertyOrSelector];
        if (new Set(propertyNames).size !== propertyNames.length) {
            throw new Error(
                `Principal key of relationship '${this.metadata.navigationProperty}' lists a property more than once.`,
            );
        }
        this.metadata.principalKeyProperties = propertyNames;
        return this;
    }

    public onDelete(deleteBehavior: DeleteBehavior): this {
        this.metadata.deleteBehavior = deleteBehavior;
        return this;
    }

    public hasConstraintName(constraintName: string): this {
        this.metadata.constraintName = constraintName;
        return this;
    }
}
