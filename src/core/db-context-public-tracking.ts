import type { ChangeTracker } from '../tracking/change-tracker-types';
import type { EntityEntry as InternalEntityEntry } from '../tracking/entity-entry';
import type { EntityEntry } from '../tracking/entity-entry-types';
import { publicChangeTracker } from '../tracking/public-change-tracker';
import {
    internalEntityEntry,
    publicEntityEntry,
} from '../tracking/public-entity-entry';
import type { DbContextHost } from './db-context-host';
import { assertNavigationLoadableEntry } from './navigation-load-guard';

/** Keeps internal tracker objects behind the public context facades. */
export class DbContextPublicTracking {
    private trackerFacade?: ChangeTracker;

    constructor(private readonly host: DbContextHost) {}

    public get changeTracker(): ChangeTracker {
        this.trackerFacade ??= publicChangeTracker(
            this.host.changeTracker,
            this.host,
        );
        return this.trackerFacade;
    }

    public entry<TEntity extends object>(
        entity: TEntity,
    ): EntityEntry<TEntity> | undefined {
        const entry = this.host.entry(entity);
        return entry ? publicEntityEntry(entry, this.host) : undefined;
    }

    public internalEntry<TEntity extends object>(
        entry: EntityEntry<TEntity>,
    ): InternalEntityEntry<TEntity> {
        const internal = internalEntityEntry(entry);
        assertNavigationLoadableEntry(this.host.changeTracker, internal);
        return internal;
    }
}
