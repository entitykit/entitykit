import type { EntityMetadata } from '../model/entity-metadata';
import type { RelationshipMetadata } from '../model/relationship-metadata';
import { RelationshipCardinality } from '../model/relationship-metadata';
import type { IncludeLoaderContext, IncludeLoadRoot, ManyToManyRelationshipInfo } from './include-loader-context';
import {
    getUniqueObjectList,
    mergeNavigationItems,
    pushUnique,
    pushUniqueObject,
    uniqueEntityInstances,
    type UniqueObjectList,
} from './include-navigation-helpers';
import {
    dependentStitchKey,
    manyToManyEntityStitchKey,
    manyToManyRowStitchKey,
    principalStitchKey,
} from './include-stitch-keys';

/**
 * Wire freshly loaded rows onto the navigation properties of their parents
 * (and, where configured, the inverse navigation on the children), then mark
 * those navigations loaded.
 *
 * Strategies decide which rows to load; this class owns their shared,
 * identity-preserving assignment path.
 */
export class IncludeStitcher {
    constructor(private readonly ctx: IncludeLoaderContext) {}

    public assignDependentsToPrincipals<TPrincipal extends object>(
        principalMetadata: EntityMetadata<TPrincipal>,
        principals: ReadonlyArray<IncludeLoadRoot<TPrincipal>>,
        dependentMetadata: EntityMetadata,
        relationship: RelationshipMetadata<object, TPrincipal>,
        dependents: readonly object[],
    ): object[] {
        const dependentsByPrincipalKey: Map<string, object[]> = new Map();
        const principalsByKey = new Map(
            principals.map(principal => [
                principalStitchKey(principalMetadata, relationship, principal.values),
                principal.entity,
            ]),
        );

        for (const dependent of dependents) {
            const key = dependentStitchKey(
                dependentMetadata,
                relationship,
                dependent,
            );
            const group = dependentsByPrincipalKey.get(key) ?? [];
            pushUnique(group, dependent);
            dependentsByPrincipalKey.set(key, group);

            const principal = principalsByKey.get(key);
            if (principal) {
                (dependent as Record<string, unknown>)[relationship.navigationProperty] = principal;
                this.markLoaded(dependent, relationship.navigationProperty);
            }
        }

        const inverseNavigation = relationship.inverseNavigationProperty;
        if (!inverseNavigation) {
            throw new Error(
                `Relationship '${String(relationship.navigationProperty)}' does not configure an inverse navigation.`,
            );
        }
        for (const { entity: principal, values } of principals) {
            const key = principalStitchKey(
                principalMetadata,
                relationship,
                values,
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
            this.markLoaded(principal, inverseNavigation);
        }

        return uniqueEntityInstances(dependents);
    }

    public assignManyToManyRelated(
        rows: ReadonlyArray<Record<string, unknown>>,
        relatedEntities: readonly object[],
        currentEntities: readonly IncludeLoadRoot[],
        info: ManyToManyRelationshipInfo,
    ): object[] {
        const relatedByParentKey: Map<string, UniqueObjectList> = new Map();
        const inverseParentsByRelated = info.relatedInverseNavigationProperty
            ? new Map<object, UniqueObjectList>()
            : undefined;

        for (let index = 0; index < rows.length; index++) {
            const related = relatedEntities.at(index);
            if (!related) {
                continue;
            }

            const row = rows.at(index);
            if (!row) {
                continue;
            }
            const parentKey = manyToManyRowStitchKey(
                info,
                row,
                this.ctx.valueReader,
            );
            pushUniqueObject(getUniqueObjectList(relatedByParentKey, parentKey), related);
        }

        for (const { entity, values } of currentEntities) {
            const group = relatedByParentKey.get(
                manyToManyEntityStitchKey(info, values),
            )?.items ?? [];
            (entity as Record<string, unknown>)[info.navigationProperty] = group;
            this.markLoaded(entity, info.navigationProperty);

            if (inverseParentsByRelated) {
                for (const related of group) {
                    pushUniqueObject(getUniqueObjectList(inverseParentsByRelated, related), entity);
                }
            }
        }

        if (inverseParentsByRelated && info.relatedInverseNavigationProperty) {
            for (const [related, parents] of inverseParentsByRelated) {
                mergeNavigationItems(related as Record<string, unknown>, info.relatedInverseNavigationProperty, parents.items);
            }
        }

        return uniqueEntityInstances(relatedEntities);
    }

    private markLoaded(entity: object, navigationProperty: string): void {
        this.ctx.changeTracker.entry(entity)?.markNavigationLoaded(navigationProperty);
    }
}
