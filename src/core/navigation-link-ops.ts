import type { Model } from '../model/model';
import type { EntityMetadata } from '../model/entity-metadata';
import type { ManyToManyMetadata } from '../model/many-to-many-metadata';
import { selectPropertyName, type PropertySelector } from '../model/model-property-selector';
import type { ManyToManyChange } from './many-to-many-change';
import type { ManyToManyChangeSet } from './many-to-many-change-set';

/**
 * The many-to-many `link(...)` / `unlink(...)` side of a `DbContext`: it
 * validates the relationship against the model, queues the join-table change,
 * and keeps the in-memory navigation collection in step. Held apart from the
 * unit-of-work hub because it needs only the model (for lookup) and the queued
 * change set (which it appends to); the model resolves lazily, because a context
 * builds its collaborators before it has one.
 */
export class NavigationLinkOps {
    constructor(
        private readonly getModelMetadata: () => Model,
        private readonly manyToMany: ManyToManyChangeSet,
    ) {}

    private get modelMetadata(): Model {
        return this.getModelMetadata();
    }

    /**
   * Queue a many-to-many link row to be inserted on the next `saveChanges()`.
   */
    public link<TEntity extends object, TTarget extends object>(
        source: TEntity,
        navigationSelector: PropertySelector<TEntity, readonly TTarget[] | TTarget[]>,
        target: TTarget,
    ): void {
        this.queueManyToManyChange('link', source, navigationSelector, target);
        addNavigationItem(source as Record<string, unknown>, selectPropertyName(navigationSelector), target);
    }

    /**
   * Queue a many-to-many link row to be deleted on the next `saveChanges()`.
   */
    public unlink<TEntity extends object, TTarget extends object>(
        source: TEntity,
        navigationSelector: PropertySelector<TEntity, readonly TTarget[] | TTarget[]>,
        target: TTarget,
    ): void {
        this.queueManyToManyChange('unlink', source, navigationSelector, target);
        removeNavigationItem(source as Record<string, unknown>, selectPropertyName(navigationSelector), target);
    }

    private queueManyToManyChange<TEntity extends object, TTarget extends object>(
        action: 'link' | 'unlink',
        source: TEntity,
        navigationSelector: PropertySelector<TEntity, readonly TTarget[] | TTarget[]>,
        target: TTarget,
    ): void {
        const navigationProperty = selectPropertyName(navigationSelector);
        const sourceMetadata = this.modelMetadata.tryGetEntity<TEntity>(source.constructor);
        const targetMetadata = this.modelMetadata.tryGetEntity<TTarget>(target.constructor);

        if (!sourceMetadata || !targetMetadata) {
            throw new Error('Both sides of a many-to-many link must be registered entity instances.');
        }

        const relationship = sourceMetadata.manyToManyRelationships.find(item => item.navigationProperty === navigationProperty);
        if (!relationship) {
            throw new Error(`Navigation '${navigationProperty}' on entity '${sourceMetadata.entityName}' is not configured as a many-to-many relationship.`);
        }

        if (relationship.targetEntity !== targetMetadata.ctor) {
            throw new Error(`Navigation '${navigationProperty}' on entity '${sourceMetadata.entityName}' targets '${relationship.targetEntity.name}', not '${targetMetadata.entityName}'.`);
        }

        const change: ManyToManyChange = {
            action,
            source,
            target,
            sourceMetadata: sourceMetadata as unknown as EntityMetadata,
            targetMetadata: targetMetadata as unknown as EntityMetadata,
            relationship: relationship as unknown as ManyToManyMetadata,
        };
        this.manyToMany.queue(change);
    }
}

function addNavigationItem(values: Record<string, unknown>, navigationProperty: string, item: object): void {
    const current = values[navigationProperty];
    const collection = Array.isArray(current) ? current : [];
    if (!collection.includes(item)) {
        collection.push(item);
    }
    values[navigationProperty] = collection;
}

function removeNavigationItem(values: Record<string, unknown>, navigationProperty: string, item: object): void {
    const current = values[navigationProperty];
    if (!Array.isArray(current)) {
        values[navigationProperty] = [];
        return;
    }
    values[navigationProperty] = current.filter(existing => existing !== item);
}
