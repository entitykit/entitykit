import type { DbContextOptions } from './context-options/db-context-option-types';
import type { LazyLoaderHost } from './lazy-loading';
import type { ChangeTracker } from '../tracking/change-tracker';
import type { EntityEntry } from '../tracking/entity-entry';
import type { Model } from '../model/model';
import { startElapsedTimer } from '../diagnostics/runtime/elapsed-time';

/**
 * What the coordinator needs from its `DbContext`: the change tracker that owns
 * entity entries, the resolved options (lazy-loading budget, diagnostics,
 * provider), the model for navigation-name lookup, and the one query path that
 * actually loads a navigation. All are public members, so the coordinator never
 * reaches into context internals — the one private capability it needs, the
 * disposed check, is passed as a closure.
 */
export interface LazyNavigationHost {
    readonly changeTracker: ChangeTracker;
    readonly options: DbContextOptions;
    readonly modelMetadata: Model;
    loadNavigation(entry: EntityEntry<object>, navigationProperty: string): Promise<unknown>;
}

/**
 * The awaitable-lazy-loading side of a `DbContext`: it serves
 * `lazy(entity).navigation`, dedupes concurrent awaits of the same navigation,
 * and enforces the per-context load budget that turns a silent N+1 into a clear
 * error. It owns the in-flight map and the load counter — state that is nobody
 * else's business — and implements {@link LazyLoaderHost} so the context can
 * attach it to tracked entities directly.
 */
export class LazyNavigationCoordinator implements LazyLoaderHost {
    private readonly pendingLazyLoads: Map<string, Promise<unknown>> = new Map();
    private lazyLoadCount = 0;

    constructor(
        private readonly host: LazyNavigationHost,
        private readonly assertNotDisposed: (operation: string) => void,
    ) {}

    /**
   * Serve `lazy(entity).navigation`.
   *
   * Concurrent awaits of the same navigation share one query: the in-flight
   * promise is cached until it settles, so a `Promise.all` over several
   * navigations of one entity does not issue the same load twice.
   */
    public async loadNavigationLazily(entity: object, navigationProperty: string): Promise<unknown> {
        const elapsed = startElapsedTimer();
        this.assertNotDisposed(`lazy(...).${navigationProperty}`);

        const entry = this.host.changeTracker.entry(entity);
        if (!entry) {
            throw new Error(
                `lazy(...).${navigationProperty} needs an entity tracked by this DbContext. ` +
        `'${entity.constructor.name || 'entity'}' is not tracked — it may have been detached, or the tracker cleared.`,
            );
        }

        if (entry.isNavigationLoaded(navigationProperty)) {
            this.emitDiagnostic(entry.metadata.entityName, navigationProperty, false, elapsed());
            return (entity as Record<string, unknown>)[navigationProperty];
        }

        const pendingKey = `${entry.metadata.entityName}:${String(entry.keyValue)}:${navigationProperty}`;
        const inFlight = this.pendingLazyLoads.get(pendingKey);
        if (inFlight) {
            return inFlight;
        }

        const budget = this.host.options.lazyLoading?.maxPerContext;
        if (budget !== undefined && this.lazyLoadCount >= budget) {
            throw new Error(
                `This DbContext has performed ${String(this.lazyLoadCount)} lazy loads, which is its configured maximum. ` +
        'A lazy load inside a loop is an N+1; load the relationship with include(...) instead, or raise maxPerContext.',
            );
        }
        this.lazyLoadCount += 1;

        const load = this.host.loadNavigation(entry, navigationProperty)
            .finally(() => this.pendingLazyLoads.delete(pendingKey));
        this.pendingLazyLoads.set(pendingKey, load);

        const value = await load;
        this.emitDiagnostic(entry.metadata.entityName, navigationProperty, true, elapsed());
        return value;
    }

    /**
   * Navigation names configured on an entity, for `lazy(...)` validation.
   *
   * An entity's collection navigations are usually declared on the *other*
   * side — `Author.posts` is the inverse of the relationship configured on
   * `Post` — so the whole model is scanned, not just this entity's own
   * relationships.
   */
    public navigationNamesFor(entity: object): readonly string[] {
        const metadata = this.host.changeTracker.entry(entity)?.metadata
      ?? this.host.modelMetadata.tryGetEntity(entity.constructor);
        if (!metadata) {
            return [];
        }

        const names: string[] = [
            ...metadata.relationships.map(relationship => relationship.navigationProperty),
            ...metadata.manyToManyRelationships.map(relationship => relationship.navigationProperty),
        ];

        for (const other of this.host.modelMetadata.entities) {
            for (const relationship of other.relationships) {
                const inverseNavigation: unknown = relationship.inverseNavigationProperty;
                if (relationship.principalEntity === metadata.ctor && typeof inverseNavigation === 'string') {
                    names.push(inverseNavigation);
                }
            }
            for (const relationship of other.manyToManyRelationships) {
                const inverseNavigation: unknown = relationship.inverseNavigationProperty;
                if (relationship.targetEntity === metadata.ctor && typeof inverseNavigation === 'string') {
                    names.push(inverseNavigation);
                }
            }
        }

        return names.filter((name, index, all) => all.indexOf(name) === index).sort();
    }

    private emitDiagnostic(entityName: string, navigationProperty: string, queried: boolean, durationMs: number): void {
        for (const handler of this.host.options.diagnostics) {
            handler({
                kind: 'lazyLoad',
                provider: this.host.options.provider.provider,
                entityName,
                navigationProperty,
                queried,
                contextLoadCount: this.lazyLoadCount,
                durationMs,
            });
        }
    }
}
