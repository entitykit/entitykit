import type { Model } from '../model/model';
import { selectPropertyName, type PropertySelector } from '../model/model-property-selector';
import { copyNavigationCollection } from '../tracking/navigation-collection-copy';
import { writeFailureAtomicNavigation } from '../failure-atomic-navigation-write';
import { RestorationScope } from '../restoration-scope';
import { buildNavigationLinkChange } from './navigation-link-change';
import type { ManyToManyChangeSet } from './many-to-many-change-set';

/**
 * The many-to-many `link(...)` / `unlink(...)` side of a `DbContext`: it
 * validates the relationship against the model, queues the join-table change,
 * and keeps the in-memory navigation collection in step. Held apart from the
 * unit-of-work hub because it needs only the model (for lookup) and the queued
 * change set (which it appends to); the model resolves lazily, because a context
 * builds its collaborators before it has one.
 *
 * The queued change and the navigation write succeed or fail together. A refused
 * collection write cancels exactly the change this call queued and restores the
 * navigation, so a caller who catches the throw keeps the graph and the save
 * plan it had before -- and a restoration the accessor refuses poisons the
 * context rather than persisting a mutation that never happened.
 */
export class NavigationLinkOps {
    constructor(
        private readonly getModelMetadata: () => Model,
        private readonly manyToMany: ManyToManyChangeSet,
        private readonly markRestorationFailure: (error: unknown) => void,
    ) {}

    /**
   * Queue a many-to-many link row to be inserted on the next `saveChanges()`.
   */
    public link<TEntity extends object, TTarget extends object>(
        source: TEntity,
        navigationSelector: PropertySelector<TEntity, readonly TTarget[] | TTarget[]>,
        target: TTarget,
    ): void {
        this.apply('link', source, navigationSelector, target, linkedCollection);
    }

    /**
   * Queue a many-to-many link row to be deleted on the next `saveChanges()`.
   */
    public unlink<TEntity extends object, TTarget extends object>(
        source: TEntity,
        navigationSelector: PropertySelector<TEntity, readonly TTarget[] | TTarget[]>,
        target: TTarget,
    ): void {
        this.apply('unlink', source, navigationSelector, target, unlinkedCollection);
    }

    private apply<TEntity extends object, TTarget extends object>(
        action: 'link' | 'unlink',
        source: TEntity,
        navigationSelector: PropertySelector<TEntity, readonly TTarget[] | TTarget[]>,
        target: TTarget,
        nextCollection: (current: unknown, item: object) => unknown[],
    ): void {
        const navigationProperty = selectPropertyName(navigationSelector);
        const { change, entityName } = buildNavigationLinkChange(
            this.getModelMetadata(), action, source, navigationProperty, target,
        );
        const cancelQueuedChange = this.manyToMany.queue(change);
        const scope = new RestorationScope(this.markRestorationFailure);
        try {
            writeFailureAtomicNavigation({
                entity: source,
                navigationProperty,
                value: nextCollection(
                    (source as Record<string, unknown>)[navigationProperty],
                    target,
                ),
                entityName,
                scope,
            });
        } catch (error) {
            scope.capturePrimary(error);
            scope.attempt(cancelQueuedChange);
            scope.rethrowPrimary();
        }
    }
}

/** Copy the collection and add the linked item, never mutating the live one. */
function linkedCollection(current: unknown, item: object): unknown[] {
    const next = copyNavigationCollection(current);
    if (!next.includes(item)) {
        next.push(item);
    }
    return next;
}

/** Copy the collection without the unlinked item. */
function unlinkedCollection(current: unknown, item: object): unknown[] {
    return copyNavigationCollection(current)
        .filter(existing => existing !== item);
}
