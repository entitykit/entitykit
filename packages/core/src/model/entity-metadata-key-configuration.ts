import type { EntityPropertyKey } from '../types';
import { EntityKeyMetadata } from './entity-key-metadata';
import type { EntityMetadataArgs } from './entity-metadata-args';
import type { PropertyMetadata } from './property-metadata';

export interface EntityMetadataKeyConfiguration<TEntity extends object> {
    readonly keyProperties: ReadonlyArray<EntityPropertyKey<TEntity>>;
    readonly keyMetadata?: EntityKeyMetadata<TEntity>;
}

export function configureEntityMetadataKey<TEntity extends object>(
    args: EntityMetadataArgs<TEntity>,
    propertiesByName: ReadonlyMap<string, PropertyMetadata<TEntity>>,
): EntityMetadataKeyConfiguration<TEntity> {
    const keyProperties = args.keyProperties ??
        (args.keyProperty === undefined ? [] : [args.keyProperty]);
    const isKeyless = args.isKeyless ?? false;
    if (keyProperties.length === 0 && !isKeyless) {
        throw new Error(`Entity '${args.ctor.name}' must configure at least one key property.`);
    }
    if (keyProperties.length > 0 && isKeyless) {
        throw new Error(`Keyless entity '${args.ctor.name}' cannot configure a primary key.`);
    }
    if (args.isView && !isKeyless) {
        throw new Error(`View entity '${args.ctor.name}' must be keyless.`);
    }
    return {
        keyProperties,
        keyMetadata: isKeyless
            ? undefined
            : new EntityKeyMetadata(args.ctor.name, keyProperties, propertiesByName),
    };
}
