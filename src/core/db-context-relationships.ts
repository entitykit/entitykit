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
    );

    protected constructor() {
        super();
        this.changeTracker.observeDetached(entity => {
            return this.manyToMany.cancelFor(entity);
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
        this.navigationLinks.unlink(source, navigationSelector, target);
    }

    protected override cancelAddedEntity(entity: object): void {
        this.manyToMany.cancelFor(entity);
        super.cancelAddedEntity(entity);
    }
}
