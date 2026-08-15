import type {
    IncludeLoaderContext,
    IncludeLoadRoot,
    ManyToManyRelationshipInfo,
} from './include-loader-context';
import {
    getUniqueObjectList,
    mergeNavigationItems,
    pushUniqueObject,
    type UniqueObjectList,
} from './include-navigation-helpers';
import { uniqueIncludeRoots } from './include-load-root';
import {
    manyToManyEntityStitchKey,
    manyToManyRowStitchKey,
} from './include-stitch-keys';
import { markIncludeNavigationLoaded } from './include-navigation-loaded-state';
import { includeNavigationHasPendingIntent } from './include-pending-relationship';
import { writeVerifiedNavigation } from '../tracking/verified-navigation-write';

/** Stitch a many-to-many result without overwriting pending graph intent. */
export function assignManyToManyRelated(
    ctx: IncludeLoaderContext,
    rows: ReadonlyArray<Record<string, unknown>>,
    relatedRoots: readonly IncludeLoadRoot[],
    currentEntities: readonly IncludeLoadRoot[],
    info: ManyToManyRelationshipInfo,
): IncludeLoadRoot[] {
    const relatedByParentKey: Map<string, UniqueObjectList> = new Map();
    const inverseParents = info.relatedInverseNavigationProperty
        ? new Map<object, UniqueObjectList>()
        : undefined;
    const appliedRelated: Set<object> = new Set();
    for (let index = 0; index < rows.length; index++) {
        const related = relatedRoots.at(index)?.entity;
        const row = rows.at(index);
        if (!related || !row) continue;
        const key = manyToManyRowStitchKey(info, row, ctx.valueReader);
        pushUniqueObject(getUniqueObjectList(relatedByParentKey, key), related);
    }
    for (const { entity, boundValues } of currentEntities) {
        if (includeNavigationHasPendingIntent(
            ctx, entity, info.navigationProperty,
        )) continue;
        const group = relatedByParentKey.get(
            manyToManyEntityStitchKey(info, boundValues),
        )?.items ?? [];
        writeVerifiedNavigation(
            entity,
            info.navigationProperty,
            group,
            info.currentMetadata.entityName,
        );
        markIncludeNavigationLoaded(ctx, entity, info.navigationProperty);
        for (const related of group) {
            appliedRelated.add(related);
            if (inverseParents) {
                pushUniqueObject(
                    getUniqueObjectList(inverseParents, related), entity,
                );
            }
        }
    }
    stitchManyToManyInverses(ctx, inverseParents, info);
    return uniqueIncludeRoots(relatedRoots.filter(root =>
        appliedRelated.has(root.entity)));
}

function stitchManyToManyInverses(
    ctx: IncludeLoaderContext,
    inverseParents: Map<object, UniqueObjectList> | undefined,
    info: ManyToManyRelationshipInfo,
): void {
    const inverse = info.relatedInverseNavigationProperty;
    if (!inverseParents || !inverse) return;
    for (const [related, parents] of inverseParents) {
        if (includeNavigationHasPendingIntent(ctx, related, inverse)) continue;
        mergeNavigationItems(
            related as Record<string, unknown>,
            inverse,
            parents.items,
            info.relatedMetadata.entityName,
        );
    }
}
