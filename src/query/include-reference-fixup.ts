import type { RelationshipMetadata } from '../model/relationship-metadata';
import { RelationshipCardinality } from '../model/relationship-metadata';
import type { EntityEntry } from '../tracking/entity-entry';
import { fixupLoadedReference } from '../tracking/loaded-reference-fixup';
import type { TrackedRelationshipMetadata } from '../tracking/tracked-relationship-metadata';
import type { IncludeLoaderContext } from './include-loader-context';
import { markIncludeNavigationLoaded } from './include-navigation-loaded-state';

export function fixupIncludedReference<TEntity extends object>(
    ctx: IncludeLoaderContext,
    entity: TEntity,
    relationship: RelationshipMetadata<TEntity>,
    principal: object | null,
): void {
    const entry = ctx.changeTracker.entry(entity);
    if (entry && ctx.fixupTrackedGraph) {
        fixupLoadedReference(
            ctx.changeTracker,
            entry as unknown as EntityEntry<object>,
            relationship as unknown as TrackedRelationshipMetadata,
            principal,
        );
    } else {
        (entity as Record<string, unknown>)[
            relationship.navigationProperty
        ] = principal;
    }
    if (principal) {
        fixupOneToOneInverse(
            ctx,
            entity,
            relationship,
            principal,
            Boolean(entry) && ctx.fixupTrackedGraph,
        );
    }
}

function fixupOneToOneInverse<TEntity extends object>(
    ctx: IncludeLoaderContext,
    dependent: TEntity,
    relationship: RelationshipMetadata<TEntity>,
    principal: object,
    tracked: boolean,
): void {
    const inverse: unknown = relationship.inverseNavigationProperty;
    if (
        relationship.cardinality !== RelationshipCardinality.OneToOne ||
        typeof inverse !== 'string'
    ) return;
    if (!tracked) {
        const values = principal as Record<string, unknown>;
        const existing = values[inverse];
        if (existing && existing !== dependent) {
            throw new Error(
                `One-to-one relationship '${inverse}' matched more than one dependent entity.`,
            );
        }
        values[inverse] = dependent;
    }
    markIncludeNavigationLoaded(ctx, principal, inverse);
}
