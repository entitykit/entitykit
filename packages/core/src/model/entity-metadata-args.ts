import type {
    EntityConstructor,
    EntityMaterializer,
    EntityPropertyKey,
} from '../types';
import type { AlternateKeyMetadata } from './alternate-key-metadata';
import type { CheckConstraintMetadata } from './check-constraint-metadata';
import type { ComplexPropertyMetadata } from './complex-property-metadata';
import type { IndexMetadata } from './index-metadata';
import type { ManyToManyMetadata } from './many-to-many-metadata';
import type { PropertyMetadata } from './property-metadata';
import type { RelationshipMetadata } from './relationship-metadata';
import type { AuditMetadata, SoftDeleteMetadata } from './saas-metadata';
import type { CheckedEntityMaterializer } from './checked-materialization-types';

export interface EntityMetadataArgs<TEntity extends object> {
    ctor: EntityConstructor<TEntity>;
    materializer?: EntityMaterializer<TEntity>;
    checkedMaterializer?: CheckedEntityMaterializer<TEntity>;
    tableName: string;
    schemaName?: string;
    /** Keyless mappings are query-only and never participate in tracking. */
    isKeyless?: boolean;
    /** Views are query-only store objects and are excluded from generated DDL. */
    isView?: boolean;
    keyProperty?: EntityPropertyKey<TEntity>;
    keyProperties?: ReadonlyArray<EntityPropertyKey<TEntity>>;
    alternateKeys?: ReadonlyArray<AlternateKeyMetadata<TEntity>>;
    checkConstraints?: readonly CheckConstraintMetadata[];
    properties: ReadonlyArray<PropertyMetadata<TEntity>>;
    complexProperties?: readonly ComplexPropertyMetadata[];
    ignoredProperties?: ReadonlyArray<EntityPropertyKey<TEntity>>;
    indexes?: ReadonlyArray<IndexMetadata<TEntity>>;
    relationships?: ReadonlyArray<RelationshipMetadata<TEntity>>;
    manyToManyRelationships?: ReadonlyArray<ManyToManyMetadata<TEntity>>;
    audit?: AuditMetadata<TEntity>;
    softDelete?: SoftDeleteMetadata<TEntity>;
    tenantKeyProperty?: EntityPropertyKey<TEntity>;
}
