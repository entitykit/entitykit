import type { EntityMetadata } from '../model/entity-metadata';
import type { RelationshipMetadata } from '../model/relationship-metadata';
import type { IncludeLoaderContext, IncludeLoadRoot, LoadedIncludeResult } from './include-loader-context';
import type { IncludePropertyLoader } from './include-loader-key-batch';
import type { IncludeStitcher } from './include-loader-stitch';
import { IncludeStrategyBase } from './include-strategy-base';
import { isCompleteTuple } from './include-key-helpers';
import { uniquePropertyTuples } from './include-property-key-helpers';
import { IncludeOneToManyFilteredLoader } from './include-one-to-many-filtered-loader';
import type { IncludeFilterModel } from './query-model';
import { RelationshipCardinality } from '../model/relationship-metadata';
import {
    principalValuesForDependent,
} from '../model/relationship-key-translation';
import { startElapsedTimer } from '../diagnostics/runtime/elapsed-time';

/**
 * One-to-many eager load (principal -> collection of dependents).
 *
 * The batched path loads every dependent by its foreign key in a single query
 * and stitches them onto their principals. Two fallbacks handle an include that
 * carries its own limit/offset: the windowed batch keeps a single query by
 * ranking dependents per parent with `row_number()`, but it can only partition
 * on one foreign-key column, so a composite key (or a provider whose dialect
 * does not declare window-function support) drops to the per-principal path --
 * slower, one query per parent, but correct.
 * Note the windowed inner SELECT lists the entity columns *before* the parent
 * key, and binds parent keys through the compiled `in (...)` predicate; the
 * many-to-many windowed variant deliberately differs, so keep the two apart.
 */
export class IncludeStrategyOneToMany extends IncludeStrategyBase {
    private readonly filteredLoader: IncludeOneToManyFilteredLoader;

    constructor(
        ctx: IncludeLoaderContext,
        private readonly propertyLoader: IncludePropertyLoader,
        private readonly stitcher: IncludeStitcher,
    ) {
        super(ctx);
        this.filteredLoader = new IncludeOneToManyFilteredLoader(
            ctx,
            propertyLoader,
            stitcher,
        );
    }

    public async load<TPrincipal extends object>(
        principalMetadata: EntityMetadata<TPrincipal>,
        principals: ReadonlyArray<IncludeLoadRoot<TPrincipal>>,
        dependentMetadata: EntityMetadata,
        relationship: RelationshipMetadata<object, TPrincipal>,
        filter?: IncludeFilterModel,
    ): Promise<LoadedIncludeResult> {
        const elapsed = startElapsedTimer();
        const principalKeys = uniquePropertyTuples(
            dependentMetadata,
            relationship.foreignKeyProperties.map(String),
            principals
                .map(principal => principalValuesForDependent(
                    relationship,
                    dependentMetadata,
                    principalMetadata,
                    principal.values,
                ))
                .filter(isCompleteTuple),
        );

        const inverseNavigation = relationship.inverseNavigationProperty;
        if (!inverseNavigation) {
            throw new Error(`Relationship '${String(relationship.navigationProperty)}' on entity '${dependentMetadata.entityName}' does not configure an inverse navigation.`);
        }

        if (principalKeys.length === 0) {
            for (const { entity: principal } of principals) {
                (principal as Record<string, unknown>)[inverseNavigation] =
                    relationship.cardinality === RelationshipCardinality.OneToOne
                        ? null
                        : [];
                this.markLoaded(principal, inverseNavigation);
            }
            this.emitIncludeDiagnostic(principalMetadata.entityName, dependentMetadata.entityName, inverseNavigation, 'skipped', principals.length, 0, 0, 0, elapsed());
            return { metadata: dependentMetadata, roots: [] };
        }

        if (filter?.limit !== undefined || filter?.offset !== undefined) {
            return this.filteredLoader.load(
                principalMetadata,
                principals,
                dependentMetadata,
                relationship,
                inverseNavigation,
                filter,
            );
        }

        const dependents = await this.propertyLoader.loadByProperties(dependentMetadata, relationship.foreignKeyProperties, principalKeys, filter);
        const assigned = this.stitcher.assignDependentsToPrincipals(principalMetadata, principals, dependentMetadata, relationship, dependents);
        this.emitIncludeDiagnostic(principalMetadata.entityName, dependentMetadata.entityName, inverseNavigation, 'splitQuery', principals.length, principalKeys.length, dependents.length, assigned.length, elapsed());
        return { metadata: dependentMetadata, roots: assigned };
    }
}
