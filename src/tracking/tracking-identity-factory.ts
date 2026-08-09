import type { EntityMetadata } from '../model/entity-metadata';
import { isGeneratedOnAdd } from '../model/value-generated';
import { EntityState } from './entity-state';
import {
    captureTemporaryGeneratedProperty,
    type TemporaryGeneratedIdentity,
} from './temporary-generated-identity';
import {
    trackingIdentityKeyForValues,
} from './tracking-identity-key';

export interface CapturedTrackingIdentity {
    readonly identityKey: string;
    readonly temporaryGeneratedIdentity?: TemporaryGeneratedIdentity;
}

/** Creates stable or temporary identity-map keys for newly tracked entities. */
export class TrackingIdentityFactory {
    private nextTemporaryIdentity = 1;

    public createFromValues<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        state: EntityState,
        values: Readonly<Record<string, unknown>>,
    ): CapturedTrackingIdentity {
        const keyValues = metadata.keyProperties.map(
            propertyName => values[propertyName],
        );
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
            identityKey: trackingIdentityKeyForValues(metadata, values),
        };
    }
}
