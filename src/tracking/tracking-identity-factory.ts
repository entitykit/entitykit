import type { EntityMetadata } from '../model/entity-metadata';
import { isGeneratedOnAdd } from '../model/value-generated';
import { EntityState } from './entity-state';
import {
    captureTemporaryGeneratedProperty,
    type TemporaryGeneratedIdentity,
} from './temporary-generated-identity';
import {
    createTrackingIdentityKey,
    tenantIdentityValue,
} from './tracking-identity-key';

export interface CapturedTrackingIdentity {
    readonly identityKey: string;
    readonly temporaryGeneratedIdentity?: TemporaryGeneratedIdentity;
}

/** Creates stable or temporary identity-map keys for newly tracked entities. */
export class TrackingIdentityFactory {
    private nextTemporaryIdentity = 1;

    public create<TEntity extends object>(
        entity: TEntity,
        metadata: EntityMetadata<TEntity>,
        state: EntityState,
        originalValues?: Readonly<Record<string, unknown>>,
    ): CapturedTrackingIdentity {
        const keyValues = metadata.getKeyValues(entity);
        const properties = state === EntityState.Added
            ? metadata.keyPropertiesMetadata.flatMap((property, index) =>
                isGeneratedOnAdd(property.valueGenerated)
                    ? [captureTemporaryGeneratedProperty(
                        keyValues[index],
                        property,
                        metadata.entityName,
                    )]
                    : [])
            : [];
        if (properties.length > 0) {
            const identityKey = `\0entitykit:${metadata.entityName}:${
                String(this.nextTemporaryIdentity++)
            }`;
            return {
                identityKey,
                temporaryGeneratedIdentity: { identityKey, properties },
            };
        }
        return {
            identityKey: createTrackingIdentityKey(
                metadata,
                keyValues,
                tenantIdentityValue(metadata, entity, originalValues),
            ),
        };
    }
}
