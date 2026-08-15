import type { Model } from '../model/model';
import type { ManyToManyChange } from './many-to-many-change';

/** One validated join-table change plus the name its navigation lives on. */
export interface NavigationLinkChange {
    readonly change: ManyToManyChange;
    readonly entityName: string;
}

/** Validate a link/unlink against the model and build its queued change. */
export function buildNavigationLinkChange(
    model: Model,
    action: 'link' | 'unlink',
    source: object,
    navigationProperty: string,
    target: object,
): NavigationLinkChange {
    const sourceMetadata = model.tryGetEntity<object>(source.constructor);
    const targetMetadata = model.tryGetEntity<object>(target.constructor);

    if (!sourceMetadata || !targetMetadata) {
        throw new Error('Both sides of a many-to-many link must be registered entity instances.');
    }

    const relationship = sourceMetadata.manyToManyRelationships.find(
        item => item.navigationProperty === navigationProperty,
    );
    if (!relationship) {
        throw new Error(`Navigation '${navigationProperty}' on entity '${sourceMetadata.entityName}' is not configured as a many-to-many relationship.`);
    }

    if (relationship.targetEntity !== targetMetadata.ctor) {
        throw new Error(`Navigation '${navigationProperty}' on entity '${sourceMetadata.entityName}' targets '${relationship.targetEntity.name}', not '${targetMetadata.entityName}'.`);
    }

    return {
        change: {
            action,
            source,
            target,
            sourceMetadata,
            targetMetadata,
            relationship,
        },
        entityName: sourceMetadata.entityName,
    };
}
