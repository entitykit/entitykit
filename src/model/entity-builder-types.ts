import type {
    EntityConstructor,
    EntityMaterializer,
    EntityPropertyKey,
} from '../types';
import type {
    ComplexPropertyBuilder,
    ComplexPropertyOptions,
} from './complex-property-builder-types';
import type { IndexBuilder, AlternateKeyBuilder } from './index-builder-types';
import type {
    PropertyListSelector,
    PropertyPathSelector,
    PropertySelector,
} from './model-property-selector';
import type { PropertyBuilder } from './property-builder-types';
import type {
    ManyToManyRelationshipBuilder,
    RelationshipBuilder,
} from './relationship-builder-types';

/** Configures how an entity type maps to its database representation. */
export interface EntityBuilder<TEntity extends object> {
    /** Map the entity to a writable table. */ toTable(tableName: string, schemaName?: string): this;
    /** Map the entity to a read-only, keyless view. */ toView(viewName: string, schemaName?: string): this;
    /** Mark the entity as query-only and without a primary key. */ hasNoKey(): this;
    /** Set the database schema for this entity. */ hasSchema(schemaName: string): this;
    /** Add a named table check constraint. */ hasCheckConstraint(name: string, sql: string): this;
    /** Supply an explicit rehydration factory for constructor-rich entities. */ materialize(factory: EntityMaterializer<TEntity>): this;
    /** Configure one mapped scalar property. */ property<TProperty = TEntity[EntityPropertyKey<TEntity>]>(
        propertyOrSelector:
        EntityPropertyKey<TEntity> | PropertySelector<TEntity, TProperty>,
    ): PropertyBuilder<TProperty>;
    /** Perform the complex property operation. */ complexProperty<TComplex extends object | null | undefined>(
        selector: PropertySelector<TEntity, TComplex>,
        configure?: (
            complex: ComplexPropertyBuilder<TEntity, NonNullable<TComplex>>,
        ) => void,
    ): ComplexPropertyBuilder<TEntity, NonNullable<TComplex>>;
    /** Perform the complex property operation. */ complexProperty<TComplex extends object | null | undefined>(
        selector: PropertySelector<TEntity, TComplex>,
        options: ComplexPropertyOptions<NonNullable<TComplex>>,
        configure?: (
            complex: ComplexPropertyBuilder<TEntity, NonNullable<TComplex>>,
        ) => void,
    ): ComplexPropertyBuilder<TEntity, NonNullable<TComplex>>;
    /** Perform the ignore operation. */ ignore(propertyName: EntityPropertyKey<TEntity>): this;
    /** Perform the ignore operation. */ ignore<TProperty>(selector: PropertySelector<TEntity, TProperty>): this;
    /** Configure the primary key. */ hasKey(
        propertyOrSelector:
        EntityPropertyKey<TEntity> | PropertyListSelector<TEntity>,
    ): this;
    /** Configure a unique alternate key that relationships may target. */ hasAlternateKey(
        propertyOrSelector:
        EntityPropertyKey<TEntity> | PropertyListSelector<TEntity>,
    ): AlternateKeyBuilder;
    /** Configure an index over one or more mapped properties. */ hasIndex(
        propertyOrSelector:
        EntityPropertyKey<TEntity> | PropertyListSelector<TEntity>,
    ): IndexBuilder<TEntity>;
    /** Configure an index over provider-specific SQL expressions. */ hasExpressionIndex(
        expressionOrExpressions: string | readonly string[],
    ): IndexBuilder<TEntity>;
    /** Configure one and return this builder. */ hasOne<TPrincipal extends object, TNavigation>(
        principalEntity: EntityConstructor<TPrincipal>,
        navigationSelector: PropertySelector<TEntity, TNavigation>,
    ): RelationshipBuilder<TEntity, TPrincipal>;
    /** Configure many to many and return this builder. */ hasManyToMany<TTarget extends object, TNavigation>(
        targetEntity: EntityConstructor<TTarget>,
        navigationSelector: PropertySelector<TEntity, TNavigation>,
    ): ManyToManyRelationshipBuilder<TTarget>;
    /** Perform the audit operation. */ audit(config: EntityAuditConfiguration<TEntity>): this;
    /** Perform the soft delete operation. */ softDelete(
        propertyName: EntityPropertyKey<TEntity>,
        deletedValue?: unknown,
    ): this;
    /** Perform the soft delete operation. */ softDelete<TProperty>(
        selector: PropertyPathSelector<TEntity, TProperty>,
        deletedValue?: unknown,
    ): this;
    /** Perform the tenant key operation. */ tenantKey(propertyName: EntityPropertyKey<TEntity>): this;
    /** Perform the tenant key operation. */ tenantKey<TProperty>(selector: PropertyPathSelector<TEntity, TProperty>): this;
}

/** Identifies conventional audit properties for an entity type. */
export interface EntityAuditConfiguration<TEntity extends object> {
    /** The created at. */ readonly createdAt?: EntityPropertyKey<TEntity> | PropertyPathSelector<TEntity>;
    /** The updated at. */ readonly updatedAt?: EntityPropertyKey<TEntity> | PropertyPathSelector<TEntity>;
    /** The created by. */ readonly createdBy?: EntityPropertyKey<TEntity> | PropertyPathSelector<TEntity>;
    /** The updated by. */ readonly updatedBy?: EntityPropertyKey<TEntity> | PropertyPathSelector<TEntity>;
}
