import { DbValidationError } from '../errors/entity-kit-error';
import type { EntityMetadata } from '../model/entity-metadata';
import type { ManyToManyChange } from './many-to-many-change';
import {
    encodeSaveIdentityTuple,
    formatSaveIdentityValue,
    toProviderKeyValues,
} from './save-key-values';
import type { PersistedEntrySnapshot } from '../tracking/persisted-entry-snapshot';

export interface CapturedRelationshipEndpoint {
    readonly modelKeyValues: readonly unknown[];
    readonly providerKeyValues: readonly unknown[];
    readonly encodedIdentity: string;
}

export class ManyToManyChangeValidator {
    constructor(private readonly isTracked: (entity: object) => boolean) {}

    public validate(change: ManyToManyChange): void {
        const relationshipName = this.relationshipName(change);
        this.validateEndpoint(
            change,
            'source',
            relationshipName,
            change.source,
            change.sourceMetadata,
        );
        this.validateEndpoint(
            change,
            'target',
            relationshipName,
            change.target,
            change.targetMetadata,
        );
    }

    public capturedEndpoint(
        change: ManyToManyChange,
        side: 'source' | 'target',
        snapshotsByEntity: ReadonlyMap<object, PersistedEntrySnapshot>,
        endpoints: WeakMap<object, CapturedRelationshipEndpoint>,
    ): CapturedRelationshipEndpoint {
        const entity = side === 'source' ? change.source : change.target;
        const metadata =
            side === 'source' ? change.sourceMetadata : change.targetMetadata;
        const cached = endpoints.get(entity);
        if (cached) {
            return cached;
        }

        const snapshot = snapshotsByEntity.get(entity);
        if (!snapshot) {
            this.validateEndpoint(
                change,
                side,
                this.relationshipName(change),
                entity,
                metadata,
            );
            throw new Error('Tracked relationship endpoint snapshot is unavailable.');
        }
        const modelKeyValues = metadata.keyProperties.map(propertyName =>
            snapshot.values[propertyName]);
        this.validateKeyValues(
            change,
            side,
            this.relationshipName(change),
            metadata,
            modelKeyValues,
        );
        const providerKeyValues = toProviderKeyValues(
            modelKeyValues,
            metadata,
        );
        const endpoint = {
            modelKeyValues,
            providerKeyValues,
            encodedIdentity: encodeSaveIdentityTuple(providerKeyValues),
        };
        endpoints.set(entity, endpoint);
        return endpoint;
    }

    private validateEndpoint(
        change: ManyToManyChange,
        side: 'source' | 'target',
        relationshipName: string,
        entity: object,
        metadata: EntityMetadata,
    ): readonly unknown[] {
        const keyValues = metadata.getKeyValues(entity);
        this.validateKeyValues(
            change,
            side,
            relationshipName,
            metadata,
            keyValues,
        );

        if (!this.isTracked(entity)) {
            const identity = keyValues.length === 1 ? keyValues[0] : keyValues;
            throw new DbValidationError(
                `Cannot ${change.action} many-to-many relationship '${relationshipName}' because the ${side} entity '${metadata.entityName}' with key '${formatSaveIdentityValue(identity)}' is not tracked by this DbContext.`,
                {
                    action: change.action,
                    relationship: relationshipName,
                    side,
                    entity: metadata.entityName,
                    keyValue: identity,
                },
            );
        }

        return keyValues;
    }

    private validateKeyValues(
        change: ManyToManyChange,
        side: 'source' | 'target',
        relationshipName: string,
        metadata: EntityMetadata,
        keyValues: readonly unknown[],
    ): void {
        const emptyIndex = keyValues.findIndex(
            value => value === undefined || value === null || value === '',
        );
        if (emptyIndex >= 0) {
            throw new DbValidationError(
                `Cannot ${change.action} many-to-many relationship '${relationshipName}' because the ${side} entity '${metadata.entityName}' has an empty key '${String(metadata.keyProperties[emptyIndex])}'.`,
                {
                    action: change.action,
                    relationship: relationshipName,
                    side,
                    entity: metadata.entityName,
                    keyProperty: metadata.keyProperties[emptyIndex],
                },
            );
        }
    }

    private relationshipName(change: ManyToManyChange): string {
        return `${change.sourceMetadata.entityName}.${
            String(change.relationship.navigationProperty)
        }`;
    }
}
