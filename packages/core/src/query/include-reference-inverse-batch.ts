import type { RelationshipMetadata } from '../model/relationship-metadata';
import type { EntityEntry } from '../tracking/entity-entry';
import { LoadedInverseCollectionBatch } from '../tracking/loaded-inverse-collection-batch';
import { navigationPropertyHasDynamicBehavior } from '../tracking/navigation-property-stability';
import { navigationSnapshot } from '../tracking/navigation-snapshot';
import type { IncludeLoaderContext, IncludeLoadRoot } from './include-loader-context';

/** Choose one compatible strategy before the include's first reference write. */
export function createReferenceInverseBatch<TEntity extends object>(
    ctx: IncludeLoaderContext,
    roots: ReadonlyArray<IncludeLoadRoot<TEntity>>,
    relationship: RelationshipMetadata<TEntity>,
    principals: readonly IncludeLoadRoot[] = [],
): LoadedInverseCollectionBatch | undefined {
    if (!ctx.fixupTrackedGraph) return undefined;
    const reference = relationship.navigationProperty;
    if (roots.some(root => navigationPropertyHasDynamicBehavior(root.entity, reference))) return undefined;
    const touched = new Set(principals.map(root => root.entity));
    for (const root of roots) {
        const entry = ctx.changeTracker.entry(root.entity);
        const previous = entry ? navigationSnapshot(entry as unknown as EntityEntry<object>, reference).value : undefined;
        const current = (root.entity as Record<string, unknown>)[reference];
        for (const principal of [previous, current]) {
            if (principal && typeof principal === 'object') touched.add(principal);
        }
    }
    const inverse: unknown = relationship.inverseNavigationProperty;
    if (typeof inverse === 'string' && [...touched].some(principal => navigationPropertyHasDynamicBehavior(principal, inverse))) return undefined;
    return new LoadedInverseCollectionBatch(ctx.changeTracker, ctx.journal, ctx.trackerJournal);
}
