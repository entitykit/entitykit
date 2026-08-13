import type { EntityMetadata } from '../model/entity-metadata';
import type { RelationshipMetadata } from '../model/relationship-metadata';
import type { IncludeFilterModel } from './query-model';
import type { IncludeLoaderContext, IncludeLoadRoot, LoadedIncludeResult } from './include-loader-context';
import type { IncludePropertyLoader } from './include-loader-key-batch';
import { IncludeStrategyBase } from './include-strategy-base';
import { isCompleteTuple } from './include-key-helpers';
import { uniquePropertyTuples } from './include-property-key-helpers';
import { uniqueIncludeRoots } from './include-load-root';
import {
    relationshipPrincipalKeyProperties,
} from '../model/relationship-key';
import {
    dependentRelationshipBoundKey,
    principalRelationshipBoundKey,
} from '../model/relationship-key-codec';
import { startElapsedTimer } from '../diagnostics/runtime/elapsed-time';
import {
    boundQueryTuple,
    dependentBoundTuple,
} from './include-bound-key';
import { fixupIncludedReference } from './include-reference-fixup';

/**
 * Reference (many-to-one) eager load.
 *
 * The dependent entities already carry the foreign-key columns, so this is the
 * simplest kind: collect the distinct complete FK tuples, batch-load the
 * principals by key in one query, then hand each entity back its principal via
 * a key lookup. There is no windowing or per-parent fallback here -- a
 * many-to-one navigation resolves to at most one principal per entity, so an
 * include-level limit/offset would be meaningless and never reaches this path.
 * Entities with an incomplete FK tuple are assigned `null`.
 */
export class IncludeStrategyReference extends IncludeStrategyBase {
    constructor(ctx: IncludeLoaderContext, private readonly propertyLoader: IncludePropertyLoader) {
        super(ctx);
    }

    public async load<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        roots: ReadonlyArray<IncludeLoadRoot<TEntity>>,
        relationship: RelationshipMetadata<TEntity>,
        filter?: IncludeFilterModel,
    ): Promise<LoadedIncludeResult> {
        const elapsed = startElapsedTimer();
        const foreignKeyProperties = relationship.foreignKeyProperties;
        const principalMetadata = this.ctx.model.getEntity(
            relationship.principalEntity,
        );
        const principalKeyProperties = relationshipPrincipalKeyProperties(
            relationship,
            principalMetadata,
        );
        const foreignKeyTuples = uniquePropertyTuples(
            principalMetadata,
            principalKeyProperties.map(String),
            roots.map(root => boundQueryTuple(
                dependentBoundTuple(relationship, root),
            ))
                .filter(isCompleteTuple),
        );

        if (foreignKeyTuples.length === 0) {
            for (const { entity, boundValues } of roots) {
                if (fixupIncludedReference(
                    this.ctx, entity, relationship, null,
                )) {
                    this.markLoaded(
                        entity, relationship.navigationProperty, boundValues,
                    );
                }
            }
            this.emitIncludeDiagnostic(metadata.entityName, principalMetadata.entityName, relationship.navigationProperty, 'skipped', roots.length, 0, 0, 0, elapsed());
            return { metadata: principalMetadata, roots: [] };
        }

        const principals = await this.propertyLoader.loadByProperties(
            principalMetadata,
            principalKeyProperties,
            foreignKeyTuples,
            filter,
        );
        const principalsByKey = new Map(
            principals.map(principal => [
                principalRelationshipBoundKey(
                    relationship,
                    principalMetadata,
                    principal.boundValues,
                ),
                principal,
            ]),
        );
        const loadedPrincipals: IncludeLoadRoot[] = [];

        for (const { entity, boundValues } of roots) {
            const foreignKeyTuple = foreignKeyProperties.map(
                propertyName => boundValues[propertyName],
            );
            const principalRoot = isCompleteTuple(foreignKeyTuple)
                ? principalsByKey.get(dependentRelationshipBoundKey(
                    relationship,
                    boundValues,
                )) ?? null
                : null;
            const principal = principalRoot?.entity ?? null;
            const applied = fixupIncludedReference(
                this.ctx, entity, relationship, principal,
            );
            if (principalRoot) {
                loadedPrincipals.push(principalRoot);
            }
            if (applied) {
                this.markLoaded(
                    entity, relationship.navigationProperty, boundValues,
                );
            }
        }

        const uniquePrincipals = uniqueIncludeRoots(loadedPrincipals);
        this.emitIncludeDiagnostic(metadata.entityName, principalMetadata.entityName, relationship.navigationProperty, 'splitQuery', roots.length, foreignKeyTuples.length, principals.length, uniquePrincipals.length, elapsed());
        return { metadata: principalMetadata, roots: uniquePrincipals };
    }

}
