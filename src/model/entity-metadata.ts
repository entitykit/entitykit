import type { EntityConstructor, EntityMaterializer, EntityPropertyKey } from '../types';
import type { IndexMetadata } from './index-metadata';
import type { PropertyMetadata } from './property-metadata';
import type { RelationshipMetadata } from './relationship-metadata';
import type { ManyToManyMetadata } from './many-to-many-metadata';
import type { AuditMetadata, SoftDeleteMetadata } from './saas-metadata';
import type { StoreValueReader } from '../storage/store-value-reader';
import type { EntityKeyMetadata } from './entity-key-metadata';
import { configureEntityMetadataKey } from './entity-metadata-key-configuration';
import type { AlternateKeyMetadata } from './alternate-key-metadata';
import type { CheckConstraintMetadata } from './check-constraint-metadata';
import type { EntityMetadataArgs } from './entity-metadata-args';
import type { ComplexPropertyMetadata } from './complex-property-metadata';

export class EntityMetadata<TEntity extends object = object> {
    public readonly ctor: EntityConstructor<TEntity>;
    public readonly materializer?: EntityMaterializer<TEntity>;
    public readonly entityName: string;
    public readonly tableName: string;
    public readonly schemaName?: string;
    public readonly isKeyless: boolean;
    public readonly isView: boolean;
    public readonly keyProperties: ReadonlyArray<EntityPropertyKey<TEntity>>;
    public readonly alternateKeys: ReadonlyArray<AlternateKeyMetadata<TEntity>>;
    public readonly checkConstraints: readonly CheckConstraintMetadata[];
    public readonly properties: ReadonlyArray<PropertyMetadata<TEntity>>;
    public readonly complexProperties: readonly ComplexPropertyMetadata[];
    public readonly ignoredProperties: ReadonlyArray<EntityPropertyKey<TEntity>>;
    public readonly indexes: ReadonlyArray<IndexMetadata<TEntity>>;
    public readonly relationships: ReadonlyArray<RelationshipMetadata<TEntity>>;
    public readonly manyToManyRelationships: ReadonlyArray<ManyToManyMetadata<TEntity>>;
    public readonly audit?: AuditMetadata<TEntity>;
    public readonly softDelete?: SoftDeleteMetadata<TEntity>;
    public readonly tenantKeyProperty?: EntityPropertyKey<TEntity>;
    private readonly propertiesByName: ReadonlyMap<string, PropertyMetadata<TEntity>>;
    private readonly keyMetadata?: EntityKeyMetadata<TEntity>;
    constructor(args: EntityMetadataArgs<TEntity>) {
        this.ctor = args.ctor;
        this.materializer = args.materializer;
        this.entityName = args.ctor.name;
        this.tableName = args.tableName;
        this.schemaName = args.schemaName;
        this.isKeyless = args.isKeyless ?? false;
        this.isView = args.isView ?? false;
        this.alternateKeys = args.alternateKeys ?? [];
        this.checkConstraints = args.checkConstraints ?? [];
        this.properties = args.properties;
        this.complexProperties = args.complexProperties ?? [];
        this.ignoredProperties = args.ignoredProperties ?? [];
        this.indexes = args.indexes ?? [];
        this.relationships = args.relationships ?? [];
        this.manyToManyRelationships = args.manyToManyRelationships ?? [];
        this.audit = args.audit;
        this.softDelete = args.softDelete;
        this.tenantKeyProperty = args.tenantKeyProperty;
        this.propertiesByName = new Map(
            args.properties.map(property => [property.propertyName, property]),
        );
        const key = configureEntityMetadataKey(args, this.propertiesByName);
        this.keyProperties = key.keyProperties;
        this.keyMetadata = key.keyMetadata;
    }
    public get tablePath(): readonly string[] {
        return this.schemaName ? [this.schemaName, this.tableName] : [this.tableName];
    }
    public get hasCompositeKey(): boolean {
        return this.keyMetadata?.hasCompositeKey ?? false;
    }
    public get keyProperty(): EntityPropertyKey<TEntity> {
        return this.key().keyProperty;
    }
    public get keyPropertyMetadata(): PropertyMetadata<TEntity> {
        return this.key().keyPropertyMetadata;
    }
    public get keyPropertiesMetadata(): ReadonlyArray<PropertyMetadata<TEntity>> {
        return this.key().keyPropertiesMetadata;
    }

    public assertSingleKey(feature: string): void {
        this.key().assertSingleKey(feature);
    }

    public getProperty<TProperty = unknown>(propertyName: string): PropertyMetadata<TEntity, TProperty> {
        const property = this.propertiesByName.get(propertyName);

        if (!property) {
            throw new Error(`Property '${propertyName}' is not configured on entity '${this.entityName}'.`);
        }

        return property as PropertyMetadata<TEntity, TProperty>;
    }

    public tryGetProperty(propertyName: string): PropertyMetadata<TEntity> | undefined {
        return this.propertiesByName.get(propertyName);
    }

    public getKeyValue(entity: TEntity): unknown {
        return this.key().getKeyValue(entity);
    }

    public getKeyValues(entity: TEntity): unknown[] {
        return this.key().getKeyValues(entity);
    }

    /** Key values read from a database row, in declaration order. */
    public getKeyValuesFromRow(
        row: Record<string, unknown>,
        valueReader?: StoreValueReader,
    ): unknown[] {
        return this.key().getKeyValuesFromRow(row, valueReader);
    }

    /** Convert a raw database key value into its model form. */
    public readKeyValue(value: unknown, valueReader?: StoreValueReader): unknown {
        return this.key().readKeyValue(value, valueReader);
    }

    public getKeyValueFromRow(row: Record<string, unknown>, valueReader?: StoreValueReader): unknown {
        return this.key().getKeyValueFromRow(row, valueReader);
    }

    public createIdentityKey(entity: TEntity): string {
        return this.key().createIdentityKey(entity);
    }

    public createIdentityKeyFromValue(keyValue: unknown): string {
        return this.key().createIdentityKeyFromValue(keyValue);
    }

    public createIdentityKeyFromValues(keyValues: readonly unknown[]): string {
        return this.key().createIdentityKeyFromValues(keyValues);
    }

    public createIdentityKeyFromProviderValues(
        providerValues: readonly unknown[],
    ): string {
        return this.key().createIdentityKeyFromProviderValues(providerValues);
    }

    public assertWritable(operation: string): void {
        if (this.isKeyless) {
            throw new Error(
                `${operation} is not supported for keyless entity '${this.entityName}'. Keyless entities are read-only.`,
            );
        }
    }
    private key(): EntityKeyMetadata<TEntity> {
        if (!this.keyMetadata) {
            throw new Error(`Entity '${this.entityName}' is keyless and has no primary key.`);
        }
        return this.keyMetadata;
    }
}
