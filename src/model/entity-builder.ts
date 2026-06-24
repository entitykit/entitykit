import { EntityMetadata } from './entity-metadata';
import { EntityRelationshipConfiguration } from './entity-builder/relationship-configuration';
import { validateEntityStoreGeneration } from './entity-store-generation-validation';
import {
    validateComplexPropertyRequiredness,
} from './complex-property-validation';
import type { EntityBuilder } from './entity-builder-types';
import type { EntityMaterializer } from '../types';

export class EntityBuilderImplementation<TEntity extends object>
    extends EntityRelationshipConfiguration<TEntity>
    implements EntityBuilder<TEntity> {
    private tableName?: string;
    private schemaName?: string;
    private keyless = false;
    private explicitlyKeyless = false;
    private view = false;
    private materializer?: EntityMaterializer<TEntity>;

    public toTable(tableName: string, schemaName?: string): this {
        this.view = false;
        this.keyless = this.explicitlyKeyless;
        return this.mapObject(tableName, schemaName);
    }

    private mapObject(tableName: string, schemaName?: string): this {
        this.tableName = tableName;
        if (schemaName !== undefined) {
            this.schemaName = schemaName;
        }
        return this;
    }

    /** Map this entity to a read-only database view. */
    public toView(viewName: string, schemaName?: string): this {
        this.view = true;
        this.keyless = true;
        return this.mapObject(viewName, schemaName);
    }

    /** Configure a query-only entity with no primary key. */
    public hasNoKey(): this {
        this.explicitlyKeyless = true;
        this.keyless = true;
        return this;
    }

    public hasSchema(schemaName: string): this {
        this.schemaName = schemaName;
        return this;
    }

    /** Configure a named table check constraint. */
    public hasCheckConstraint(name: string, sql: string): this {
        this.schemaFacet.checkConstraint(name, sql);
        return this;
    }

    /** Configure explicit construction for entities with required arguments. */
    public materialize(factory: EntityMaterializer<TEntity>): this {
        this.materializer = factory;
        return this;
    }

    public build(): EntityMetadata<TEntity> {
        const keyProperties = this.keysFacet.keyProperties;
        if (!this.tableName) {
            throw new Error(`Entity '${this.ctor.name}' must configure a table name.`);
        }
        if ((!keyProperties || keyProperties.length === 0) && !this.keyless) {
            throw new Error(`Entity '${this.ctor.name}' must configure a primary key.`);
        }
        if (this.keyless && keyProperties && keyProperties.length > 0) {
            throw new Error(`Entity '${this.ctor.name}' cannot configure both hasNoKey() and a primary key.`);
        }

        const finalizedProperties = this.propertiesFacet.finalizeProperties();
        const complexProperties = this.complexPropertiesFacet.finalize();
        if (finalizedProperties.length === 0) {
            throw new Error(`Entity '${this.ctor.name}' must configure at least one property.`);
        }
        validateComplexPropertyRequiredness(
            this.ctor.name,
            complexProperties,
            finalizedProperties,
        );
        for (const keyProperty of keyProperties ?? []) {
            if (!finalizedProperties.some(
                property => property.propertyName === keyProperty,
            )) {
                throw new Error(
                    `Entity '${this.ctor.name}' key '${keyProperty}' must be configured as a property.`,
                );
            }
        }

        this.propertiesFacet.validateDuplicateColumns(finalizedProperties);
        validateEntityStoreGeneration(
            this.ctor.name,
            keyProperties ?? [],
            finalizedProperties,
        );
        const alternateKeys = this.alternateKeysFacet.finalize(
            finalizedProperties,
            keyProperties ?? [],
        );
        const relationships = this.relationshipsFacet.finalizeRelationships(
            finalizedProperties,
        );
        const manyToManyRelationships =
            this.relationshipsFacet.finalizeManyToManyRelationships(
                keyProperties ?? [],
            );
        if (this.keyless && alternateKeys.length > 0) {
            throw new Error(`Keyless entity '${this.ctor.name}' cannot configure alternate keys.`);
        }
        if (
            this.keyless &&
            manyToManyRelationships.length > 0
        ) {
            throw new Error(`Keyless entity '${this.ctor.name}' cannot configure many-to-many relationships.`);
        }
        return new EntityMetadata<TEntity>({
            ctor: this.ctor,
            materializer: this.materializer,
            tableName: this.tableName,
            schemaName: this.schemaName,
            isKeyless: this.keyless,
            isView: this.view,
            keyProperties: keyProperties ?? [],
            alternateKeys,
            checkConstraints: this.schemaFacet.finalize(),
            properties: finalizedProperties,
            complexProperties,
            ignoredProperties: Array.from(this.propertiesFacet.ignoredProperties),
            indexes: this.keysFacet.finalizeIndexes(
                finalizedProperties,
                relationships,
                alternateKeys,
            ),
            relationships,
            manyToManyRelationships,
            audit: this.saasFacet.finalizeAudit(finalizedProperties),
            softDelete: this.saasFacet.finalizeSoftDelete(finalizedProperties),
            tenantKeyProperty: this.saasFacet.finalizeTenantKey(finalizedProperties),
        });
    }
}
