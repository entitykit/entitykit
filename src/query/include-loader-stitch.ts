import type { EntityMetadata } from '../model/entity-metadata';
import type { RelationshipMetadata } from '../model/relationship-metadata';
import { RelationshipCardinality } from '../model/relationship-metadata';
import type { IncludeLoaderContext, IncludeLoadRoot, ManyToManyRelationshipInfo } from './include-loader-context';
import { pushUnique } from './include-navigation-helpers';
import { uniqueIncludeRoots } from './include-load-root';
import {
    dependentStitchKey,
    principalStitchKey,
} from './include-stitch-keys';
import { markIncludeNavigationLoaded } from './include-navigation-loaded-state';
import { includeNavigationHasPendingIntent } from './include-pending-relationship';
import { assignManyToManyRelated } from './include-many-to-many-stitch';
export class IncludeStitcher {
    constructor(private readonly ctx: IncludeLoaderContext) {}

    public assignDependentsToPrincipals<TPrincipal extends object>(
        principalMetadata: EntityMetadata<TPrincipal>,
        principals: ReadonlyArray<IncludeLoadRoot<TPrincipal>>,
        dependentMetadata: EntityMetadata,
        relationship: RelationshipMetadata<object, TPrincipal>,
        dependents: readonly IncludeLoadRoot[],
    ): IncludeLoadRoot[] {
        const dependentsByPrincipalKey: Map<string, object[]> = new Map();
        const principalsByKey = new Map(
            principals.map(principal => [
                principalStitchKey(
                    principalMetadata,
                    relationship,
                    principal.boundValues,
                ),
                principal.entity,
            ]),
        );

        for (const dependentRoot of dependents) {
            const dependent = dependentRoot.entity;
            const key = dependentStitchKey(
                dependentMetadata,
                relationship,
                dependentRoot.boundValues,
            );
            const group = dependentsByPrincipalKey.get(key) ?? [];
            pushUnique(group, dependent);
            dependentsByPrincipalKey.set(key, group);

            const principal = principalsByKey.get(key);
            if (principal && !includeNavigationHasPendingIntent(
                this.ctx,
                dependent,
                String(relationship.navigationProperty),
                relationship,
            )) {
                (dependent as Record<string, unknown>)[relationship.navigationProperty] = principal;
                markIncludeNavigationLoaded(
                    this.ctx,
                    dependent,
                    relationship.navigationProperty,
                    dependentRoot.boundValues,
                );
            }
        }

        const inverseNavigation = relationship.inverseNavigationProperty;
        if (!inverseNavigation) {
            throw new Error(
                `Relationship '${String(relationship.navigationProperty)}' does not configure an inverse navigation.`,
            );
        }
        for (const { entity: principal, boundValues } of principals) {
            if (includeNavigationHasPendingIntent(
                this.ctx, principal, inverseNavigation,
            )) continue;
            const key = principalStitchKey(
                principalMetadata,
                relationship,
                boundValues,
            );
            const group = dependentsByPrincipalKey.get(key) ?? [];
            if (
                relationship.cardinality === RelationshipCardinality.OneToOne &&
                group.length > 1
            ) {
                throw new Error(
                    `One-to-one relationship '${inverseNavigation}' on '${principalMetadata.entityName}' matched ${String(group.length)} dependent rows.`,
                );
            }
            (principal as Record<string, unknown>)[inverseNavigation] =
                relationship.cardinality === RelationshipCardinality.OneToOne
                    ? group[0] ?? null
                    : group;
            markIncludeNavigationLoaded(this.ctx, principal, inverseNavigation);
        }

        return uniqueIncludeRoots(dependents);
    }

    public assignManyToManyRelated(
        rows: ReadonlyArray<Record<string, unknown>>,
        relatedRoots: readonly IncludeLoadRoot[],
        currentEntities: readonly IncludeLoadRoot[],
        info: ManyToManyRelationshipInfo,
    ): IncludeLoadRoot[] {
        return assignManyToManyRelated(
            this.ctx, rows, relatedRoots, currentEntities, info,
        );
    }
}
