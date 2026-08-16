import type { PropertySelector } from '../model/model-property-selector';
import { ManyToManyChangeSet } from './many-to-many-change-set';
import { NavigationLinkOps } from './navigation-link-ops';
import { DbContextRawSql } from './db-context-raw-sql';

/** Many-to-many link ownership and the public relationship operations. */
export abstract class DbContextRelationships extends DbContextRawSql {
    protected readonly manyToMany = new ManyToManyChangeSet(
        entity => this.changeTracker.entry(entity),
    );
    private readonly navigationLinks = new NavigationLinkOps(
        () => this.modelMetadata,
        this.manyToMany,
        error => {
            this.state.markStateRestorationFailure('rollback', error);
        },
    );

    protected constructor() {
        super();
        this.changeTracker.observeDetached(entity => {
            return this.manyToMany.cancelFor(entity);
        });
        // The queue is the durable half of a `link()`/`unlink()`, and it is
        // anchored on tracking: a detach cancels it. Publishing that fact lets
        // a rollback refuse a detach the caller never asked for.
        this.changeTracker.observeQueuedWork(entity => {
            return this.manyToMany.hasPendingFor(entity);
        });
        this.changeTracker.observeAcceptedAll(() => {
            this.manyToMany.clear();
        });
    }

    public link<TEntity extends object, TTarget extends object>(
        source: TEntity,
        navigationSelector: PropertySelector<
            TEntity,
      readonly TTarget[] | TTarget[]
        >,
        target: TTarget,
    ): void {
        this.assertStateUsable();
        this.navigationLinks.link(source, navigationSelector, target);
    }

    public unlink<TEntity extends object, TTarget extends object>(
        source: TEntity,
        navigationSelector: PropertySelector<
            TEntity,
      readonly TTarget[] | TTarget[]
        >,
        target: TTarget,
    ): void {
        this.assertStateUsable();
        this.navigationLinks.unlink(source, navigationSelector, target);
    }

}
