import { DbValidationError } from '../errors/entity-kit-error';
import type { EntityMetadata } from '../model/entity-metadata';
import type { ManyToManyChange } from './many-to-many-change';
import { formatSaveIdentityValue } from './save-key-values';

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

    public validatedKey(
        change: ManyToManyChange,
        side: 'source' | 'target',
        endpointKeys: WeakMap<object, readonly unknown[]>,
    ): readonly unknown[] {
        const entity = side === 'source' ? change.source : change.target;
        const metadata =
            side === 'source' ? change.sourceMetadata : change.targetMetadata;
        const cached = endpointKeys.get(entity);
        if (cached) {
            return cached;
        }

        const keyValue = this.validateEndpoint(
            change,
            side,
            this.relationshipName(change),
            entity,
            metadata,
        );
        endpointKeys.set(entity, keyValue);
        return keyValue;
    }

    private validateEndpoint(
        change: ManyToManyChange,
        side: 'source' | 'target',
        relationshipName: string,
        entity: object,
        metadata: EntityMetadata,
    ): readonly unknown[] {
        const keyValues = metadata.getKeyValues(entity);
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

    private relationshipName(change: ManyToManyChange): string {
        return `${change.sourceMetadata.entityName}.${
            String(change.relationship.navigationProperty)
        }`;
    }
}
