import type { EntityMetadata } from '../model/entity-metadata';
import type { RelationshipMetadata } from '../model/relationship-metadata';
import { RelationshipCardinality } from '../model/relationship-metadata';
import type { IncludeLoaderContext, IncludeLoadRoot, ManyToManyRelationshipInfo } from './include-loader-context';
import {
    getUniqueObjectList,
    mergeNavigationItems,
    pushUnique,
    pushUniqueObject,
    type UniqueObjectList,
} from './include-navigation-helpers';
import { uniqueIncludeRoots } from './include-load-root';
import {
    dependentStitchKey,
    manyToManyEntityStitchKey,
    manyToManyRowStitchKey,
    principalStitchKey,
} from './include-stitch-keys';
import { markIncludeNavigationLoaded } from './include-navigation-loaded-state';
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
            if (principal) {
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
        const relatedByParentKey: Map<string, UniqueObjectList> = new Map();
        const inverseParentsByRelated = info.relatedInverseNavigationProperty
            ? new Map<object, UniqueObjectList>()
            : undefined;

        for (let index = 0; index < rows.length; index++) {
            const relatedRoot = relatedRoots.at(index);
            if (!relatedRoot) {
                continue;
            }
            const related = relatedRoot.entity;

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

        for (const { entity, boundValues } of currentEntities) {
            const group = relatedByParentKey.get(
                manyToManyEntityStitchKey(info, boundValues),
            )?.items ?? [];
            (entity as Record<string, unknown>)[info.navigationProperty] = group;
            markIncludeNavigationLoaded(
                this.ctx, entity, info.navigationProperty,
            );
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

        return uniqueIncludeRoots(relatedRoots);
    }
}
