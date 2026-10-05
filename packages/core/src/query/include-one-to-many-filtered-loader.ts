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
import { includeKeyStatements } from './include-key-statements';
import { bindIncludeFilter } from './include-filter-bindings';

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
        filter = principals.length > 0 ? bindIncludeFilter(dependentMetadata, filter) : filter;
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
        const statements = includeKeyStatements(this.ctx.dialect, principalKeys, 1, keys => buildOneToManyWindowStatement(
            this.ctx.dialect,
            this.ctx.applyQueryFilters,
            dependentMetadata,
            relationship,
            keys,
            filter,
        ));
        const dependents: IncludeLoadRoot[] = [];
        let rowCount = 0;
        for (const statement of statements) {
            const result = await this.ctx.database.query(statement, this.ctx.operationOptions);
            rowCount += result.rowCount;
            for (const root of this.ctx.materializer.materializeManyWithValues(dependentMetadata, result.rows, this.ctx.changeTracker)) dependents.push(root);
        }
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
            rowCount,
            assigned.length,
            elapsed(),
        );
        return { metadata: dependentMetadata, roots: assigned };
    }
}
