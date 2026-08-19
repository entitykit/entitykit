import type { EntityMetadata } from '../model/entity-metadata';
import type { RelationshipMetadata } from '../model/relationship-metadata';
import type { IncludeLoaderContext, IncludeLoadRoot, LoadedIncludeResult } from './include-loader-context';
import type { IncludePropertyLoader } from './include-loader-key-batch';
import type { IncludeStitcher } from './include-loader-stitch';
import { uniquePropertyValues } from './include-property-key-helpers';
import { uniqueIncludeRoots } from './include-load-root';
import { buildOneToManyWindowStatement } from './include-one-to-many-window-sql';
import { IncludeStrategyBase } from './include-strategy-base';
import type { IncludeFilterModel } from './query-model';
import { startElapsedTimer } from '../diagnostics/runtime/elapsed-time';
import { boundQueryTuple, principalBoundTuple } from './include-bound-key';

export class IncludeOneToManyFilteredLoader extends IncludeStrategyBase {
    constructor(
        ctx: IncludeLoaderContext,
        private readonly propertyLoader: IncludePropertyLoader,
        private readonly stitcher: IncludeStitcher,
    ) {
        super(ctx);
    }

    public async load<TPrincipal extends object>(
        principalMetadata: EntityMetadata<TPrincipal>,
        principals: ReadonlyArray<IncludeLoadRoot<TPrincipal>>,
        dependentMetadata: EntityMetadata,
        relationship: RelationshipMetadata<object, TPrincipal>,
        inverseNavigation: string,
        filter: IncludeFilterModel,
    ): Promise<LoadedIncludeResult> {
        const supportsWindowBatch =
            this.ctx.dialect.supportsWindowFunctions?.() === true &&
            relationship.foreignKeyProperties.length === 1;
        return supportsWindowBatch
            ? this.loadWindowedBatch(principalMetadata, principals,
                dependentMetadata, relationship, inverseNavigation, filter)
            : this.loadPerPrincipal(principalMetadata, principals,
                dependentMetadata, relationship, inverseNavigation, filter);
    }

    private async loadPerPrincipal<TPrincipal extends object>(
        principalMetadata: EntityMetadata<TPrincipal>,
        principals: ReadonlyArray<IncludeLoadRoot<TPrincipal>>,
        dependentMetadata: EntityMetadata,
        relationship: RelationshipMetadata<object, TPrincipal>,
        inverseNavigation: string,
        filter: IncludeFilterModel,
    ): Promise<LoadedIncludeResult> {
        const elapsed = startElapsedTimer();
        const allDependents: IncludeLoadRoot[] = [];
        for (const principal of principals) {
            const principalKey = boundQueryTuple(principalBoundTuple(
                relationship,
                principalMetadata,
                principal,
            ));
            const dependents = await this.propertyLoader.loadByProperties(
                dependentMetadata,
                relationship.foreignKeyProperties,
                [principalKey],
                filter,
            );
            const uniqueDependents = uniqueIncludeRoots(dependents);
            const assigned = this.stitcher.assignDependentsToPrincipals(
                principalMetadata,
                [principal],
                dependentMetadata,
                relationship,
                uniqueDependents,
            );
            allDependents.push(...assigned);
        }

        const uniqueDependents = uniqueIncludeRoots(allDependents);
        this.emitIncludeDiagnostic(
            principalMetadata.entityName,
            dependentMetadata.entityName,
            inverseNavigation,
            'perParentFallback',
            principals.length,
            principals.length,
            allDependents.length,
            uniqueDependents.length,
            elapsed(),
        );
        return { metadata: dependentMetadata, roots: uniqueDependents };
    }

    private async loadWindowedBatch<TPrincipal extends object>(
        principalMetadata: EntityMetadata<TPrincipal>,
        principals: ReadonlyArray<IncludeLoadRoot<TPrincipal>>,
        dependentMetadata: EntityMetadata,
        relationship: RelationshipMetadata<object, TPrincipal>,
        inverseNavigation: string,
        filter: IncludeFilterModel,
    ): Promise<LoadedIncludeResult> {
        const elapsed = startElapsedTimer();
        const foreignKeyProperty = relationship.foreignKeyProperties[0];
        const principalKeys = uniquePropertyValues(
            dependentMetadata,
            foreignKeyProperty,
            principals
                .map(principal => boundQueryTuple(principalBoundTuple(
                    relationship,
                    principalMetadata,
                    principal,
                ))[0])
                .filter(value => value !== undefined && value !== null),
        );
        const statement = buildOneToManyWindowStatement(
            this.ctx.dialect,
            this.ctx.applyQueryFilters,
            dependentMetadata,
            relationship,
            principalKeys,
            filter,
        );
        const result = await this.ctx.database.query(statement, this.ctx.operationOptions);
        const dependents = this.ctx.materializer.materializeManyWithValues(
            dependentMetadata,
            result.rows,
            this.ctx.changeTracker,
        );
        const assigned = this.stitcher.assignDependentsToPrincipals(
            principalMetadata,
            principals,
            dependentMetadata,
            relationship,
            dependents,
        );
        this.emitIncludeDiagnostic(
            principalMetadata.entityName,
            dependentMetadata.entityName,
            inverseNavigation,
            'windowedBatch',
            principals.length,
            principalKeys.length,
            result.rowCount,
            assigned.length,
            elapsed(),
        );
        return { metadata: dependentMetadata, roots: assigned };
    }
}
