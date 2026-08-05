import { DbValidationError } from '../errors/entity-kit-error';
import type { EntityMetadata } from '../model/entity-metadata';
import type { ManyToManyChange } from './many-to-many-change';
import { formatSaveIdentityValue } from './save-key-values';
import type { PersistedEntrySnapshot } from '../tracking/persisted-entry-snapshot';
import {
    captureRelationshipEndpoint,
    type CapturedRelationshipEndpoint,
} from './many-to-many-captured-endpoint';
import type { EntityEntry } from '../tracking/entity-entry';
import { validateManyToManyKeyValues } from './many-to-many-key-validator';

export type { CapturedRelationshipEndpoint } from './many-to-many-captured-endpoint';

export class ManyToManyChangeValidator {
    constructor(
        private readonly trackedEntry: (
            entity: object,
        ) => EntityEntry<object> | undefined,
    ) {}

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
        validateManyToManyKeyValues(
            change,
            side,
            this.relationshipName(change),
            metadata,
            modelKeyValues,
            snapshot.entry,
        );
        const endpoint = captureRelationshipEndpoint(
            entity,
            metadata,
            snapshot,
            modelKeyValues,
        );
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
        const entry = this.trackedEntry(entity);
        validateManyToManyKeyValues(
            change,
            side,
            relationshipName,
            metadata,
            keyValues,
            entry,
        );

        if (!entry) {
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

    private relationshipName(change: ManyToManyChange): string {
        return `${change.sourceMetadata.entityName}.${
            String(change.relationship.navigationProperty)
        }`;
    }
}
