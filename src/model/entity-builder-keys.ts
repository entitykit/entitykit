import type { EntityConstructor, EntityPropertyKey } from '../types';
import { IndexBuilderImplementation } from './index-builder';
import type { IndexBuilder } from './index-builder-types';
import type { MutableIndexMetadata, IndexMetadata } from './index-metadata';
import { finalizeIndexes } from './index-metadata-finalizer';
import type { PropertyListSelector } from './model-property-selector';
import { selectPropertyNames } from './model-property-selector';
import type { PropertyMetadata } from './property-metadata';
import type { EntityBuilderProperties } from './entity-builder-properties';
import type { RelationshipMetadata } from './relationship-metadata';
import type { AlternateKeyMetadata } from './alternate-key-metadata';

/**
 * Key- and index-configuration facet.
 *
 * WHY separate: the primary key and secondary indexes are the entity's
 * uniqueness and ordering rules. Both validate against the property set — a key
 * may not list a property twice or name an ignored one, an index may not span
 * an unconfigured property — and both promote unique columns to indexes at
 * finalize time. That is a self-contained rule set that only *reads* from the
 * property registry (injected), so keeping it here isolates key/index logic
 * from property mapping and from relationships.
 */
export class EntityBuilderKeys<TEntity extends object> {
    public keyProperties?: ReadonlyArray<EntityPropertyKey<TEntity>>;
    private readonly indexes: Array<MutableIndexMetadata<TEntity>> = [];

    constructor(
        private readonly ctor: EntityConstructor<TEntity>,
        private readonly properties: EntityBuilderProperties<TEntity>,
    ) {}

    public key(propertyOrSelector: EntityPropertyKey<TEntity> | PropertyListSelector<TEntity>): void {
        const propertyNames = typeof propertyOrSelector === 'function'
            ? selectPropertyNames(propertyOrSelector)
            : [this.properties.resolvePropertyName(propertyOrSelector)];

        const seen: Set<string> = new Set();
        for (const propertyName of propertyNames) {
            if (seen.has(propertyName)) {
                throw new Error(`Key of entity '${this.ctor.name}' lists property '${propertyName}' more than once.`);
            }
            seen.add(propertyName);
            this.properties.assertNotIgnored(propertyName);
        }

        this.keyProperties = propertyNames;
        for (const propertyName of propertyNames) {
            const property = this.properties.ensureProperty(propertyName);
            property.isPrimaryKey = true;
            property.isRequired = true;
        }
    }

    public index(propertyOrSelector: EntityPropertyKey<TEntity> | PropertyListSelector<TEntity>): IndexBuilder<TEntity> {
        const propertyNames = typeof propertyOrSelector === 'function'
            ? selectPropertyNames(propertyOrSelector)
            : [propertyOrSelector];
        const index: MutableIndexMetadata<TEntity> = {
            propertyNames,
        };
        this.indexes.push(index);
        return new IndexBuilderImplementation(index);
    }

    public expressionIndex(
        expressionOrExpressions: string | readonly string[],
    ): IndexBuilder<TEntity> {
        const expressions = typeof expressionOrExpressions === 'string'
            ? [expressionOrExpressions]
            : [...expressionOrExpressions];
        if (
            expressions.length === 0 ||
            expressions.some(expression => !expression.trim())
        ) {
            throw new Error('Expression indexes require at least one non-empty SQL expression.');
        }
        const index: MutableIndexMetadata<TEntity> = {
            propertyNames: [],
            keyParts: expressions.map(expression => ({
                kind: 'expression',
                expression: expression.trim(),
            })),
        };
        this.indexes.push(index);
        return new IndexBuilderImplementation(index);
    }

    public finalizeIndexes(
        properties: ReadonlyArray<PropertyMetadata<TEntity>>,
        relationships: ReadonlyArray<RelationshipMetadata<TEntity>> = [],
        alternateKeys: ReadonlyArray<AlternateKeyMetadata<TEntity>> = [],
    ): Array<IndexMetadata<TEntity>> {
        return finalizeIndexes(
            this.ctor,
            this.indexes,
            properties,
            relationships,
            alternateKeys,
            this.keyProperties ?? [],
        );
    }
}
