import type {
    EntityConstructor,
    EntityMaterializer,
    EntityPropertyKey,
} from '../types';
import type { CheckedEntityMaterializer } from './checked-materialization-types';
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
    /** Supply a raw rehydration factory; captured mapped values are assigned after it returns. */ materialize(factory: EntityMaterializer<TEntity>): this;
    /**
     * Register a fresh-entity factory that checks requested scalar values only.
     * Captured mapped values are assigned afterward and can overwrite constructor-only transformations.
     * Replaces any prior materializer. Configuration executes no SQL.
     */
    materializeChecked(factory: CheckedEntityMaterializer<TEntity>): this;
    /** Configure one mapped scalar property. */ property<TProperty = TEntity[EntityPropertyKey<TEntity>]>(
        propertyOrSelector:
        EntityPropertyKey<TEntity> | PropertySelector<TEntity, TProperty>,
    ): PropertyBuilder<TProperty>;
    /** Map a nested value object to scalar columns; optionally configure its leaves. */ complexProperty<TComplex extends object | null | undefined>(
        selector: PropertySelector<TEntity, TComplex>,
        configure?: (
            complex: ComplexPropertyBuilder<TEntity, NonNullable<TComplex>>,
        ) => void,
    ): ComplexPropertyBuilder<TEntity, NonNullable<TComplex>>;
    /** Map a nested value object to scalar columns; optionally configure its leaves. */ complexProperty<TComplex extends object | null | undefined>(
        selector: PropertySelector<TEntity, TComplex>,
        options: ComplexPropertyOptions<NonNullable<TComplex>>,
        configure?: (
            complex: ComplexPropertyBuilder<TEntity, NonNullable<TComplex>>,
        ) => void,
    ): ComplexPropertyBuilder<TEntity, NonNullable<TComplex>>;
    /** Exclude this property from the mapped model. */ ignore(propertyName: EntityPropertyKey<TEntity>): this;
    /** Exclude this property from the mapped model. */ ignore<TProperty>(selector: PropertySelector<TEntity, TProperty>): this;
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
    /** Configure a reference navigation and return its relationship builder. */ hasOne<TPrincipal extends object, TNavigation>(
        principalEntity: EntityConstructor<TPrincipal>,
        navigationSelector: PropertySelector<TEntity, TNavigation>,
    ): RelationshipBuilder<TEntity, TPrincipal>;
    /** Configure a collection navigation and return its join-table relationship builder. */ hasManyToMany<TTarget extends object, TNavigation>(
        targetEntity: EntityConstructor<TTarget>,
        navigationSelector: PropertySelector<TEntity, TNavigation>,
    ): ManyToManyRelationshipBuilder<TTarget>;
    /** Identify properties populated by the configured audit pipeline during saveChanges(). */ audit(config: EntityAuditConfiguration<TEntity>): this;
    /** Configure an explicitly valued soft-delete marker by property name. */ softDelete<
        TPropertyName extends EntityPropertyKey<TEntity>,
    >(
        propertyName: TPropertyName,
        deletedValue: NonNullable<TEntity[TPropertyName]>,
    ): this;
    /** Configure the conventional current-time marker for a Date property. */ softDelete(
        selector: PropertyPathSelector<TEntity, Date | null | undefined>,
    ): this;
    /** Configure an explicitly valued soft-delete marker. */ softDelete<TProperty>(
        selector: PropertyPathSelector<TEntity, TProperty>,
        deletedValue: NoInfer<NonNullable<TProperty>>,
    ): this;
    /** Identify the mapped tenant property used for query filtering and write ownership checks. */ tenantKey(propertyName: EntityPropertyKey<TEntity>): this;
    /** Identify the mapped tenant property used for query filtering and write ownership checks. */ tenantKey<TProperty>(selector: PropertyPathSelector<TEntity, TProperty>): this;
}

/** Identifies conventional audit properties for an entity type. */
export interface EntityAuditConfiguration<TEntity extends object> {
    /** Property receiving the creation timestamp. */ readonly createdAt?: EntityPropertyKey<TEntity> | PropertyPathSelector<TEntity>;
    /** Property receiving the latest modification timestamp. */ readonly updatedAt?: EntityPropertyKey<TEntity> | PropertyPathSelector<TEntity>;
    /** Property receiving the creating actor identifier. */ readonly createdBy?: EntityPropertyKey<TEntity> | PropertyPathSelector<TEntity>;
    /** Property receiving the modifying actor identifier. */ readonly updatedBy?: EntityPropertyKey<TEntity> | PropertyPathSelector<TEntity>;
}
