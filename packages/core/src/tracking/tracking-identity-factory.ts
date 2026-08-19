import type { EntityMetadata } from '../model/entity-metadata';
import { isGeneratedOnAdd } from '../model/value-generated';
import { EntityState } from './entity-state';
import {
    captureTemporaryGeneratedProperty,
    type TemporaryGeneratedIdentity,
} from './temporary-generated-identity';
import {
    trackingIdentityKeyForBoundValues,
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
        boundValues: Readonly<Record<string, unknown>>,
    ): CapturedTrackingIdentity {
        const generatedIdentityProperties = [
            ...metadata.keyProperties.map(String),
            ...metadata.alternateKeys.flatMap(key =>
                key.propertyNames.map(String)),
        ].filter((property, index, all) => all.indexOf(property) === index)
            .map(property => metadata.getProperty(property));
        const properties = state === EntityState.Added
            ? generatedIdentityProperties.flatMap(property =>
                isGeneratedOnAdd(property.valueGenerated)
                    ? [captureTemporaryGeneratedProperty(
                        values[property.propertyName],
                        boundValues[property.propertyName],
                        property,
                    )]
                    : [])
            : [];
        if (properties.length > 0) {
            const generatedPrimaryKey = metadata.keyPropertiesMetadata.some(
                property => isGeneratedOnAdd(property.valueGenerated),
            );
            const identityKey = generatedPrimaryKey
                ? `\0entitykit:${metadata.entityName}:${
                    String(this.nextTemporaryIdentity++)
                }`
                : trackingIdentityKeyForBoundValues(metadata, boundValues);
            return {
                identityKey,
                temporaryGeneratedIdentity: { identityKey, properties },
            };
        }
        return {
            identityKey: trackingIdentityKeyForBoundValues(
                metadata,
                boundValues,
            ),
        };
    }
}
