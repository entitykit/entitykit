import type { EntityMetadata } from '../model/entity-metadata';
import type { RelationshipMetadata } from '../model/relationship-metadata';
import type { IncludeFilterModel } from './query-model';
import type { IncludeLoaderContext, IncludeLoadRoot, LoadedIncludeResult } from './include-loader-context';
import type { IncludePropertyLoader } from './include-loader-key-batch';
import { IncludeStrategyBase } from './include-strategy-base';
import { isCompleteTuple } from './include-key-helpers';
import { uniquePropertyTuples } from './include-property-key-helpers';
import { uniqueIncludeRoots } from './include-load-root';
import { RelationshipCardinality } from '../model/relationship-metadata';
import {
    relationshipPrincipalKeyProperties,
} from '../model/relationship-key';
import {
    dependentRelationshipProviderKey,
    principalRelationshipProviderKey,
} from '../model/relationship-key-codec';
import { dependentValuesForPrincipal } from '../model/relationship-key-translation';
import { startElapsedTimer } from '../diagnostics/runtime/elapsed-time';

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
            roots
                .map(root => dependentValuesForPrincipal(
                    relationship,
                    metadata,
                    principalMetadata,
                    root.values,
                ))
                .filter(isCompleteTuple),
        );

        if (foreignKeyTuples.length === 0) {
            for (const { entity } of roots) {
                (entity as Record<string, unknown>)[relationship.navigationProperty] = null;
                this.markLoaded(entity, relationship.navigationProperty);
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
                principalRelationshipProviderKey(
                    relationship,
                    principalMetadata,
                    principal.values,
                ),
                principal,
            ]),
        );
        const loadedPrincipals: IncludeLoadRoot[] = [];

        for (const { entity, values } of roots) {
            const foreignKeyTuple = foreignKeyProperties.map(
                propertyName => values[propertyName],
            );
            const principalRoot = isCompleteTuple(foreignKeyTuple)
                ? principalsByKey.get(dependentRelationshipProviderKey(
                    relationship,
                    metadata,
                    values,
                )) ?? null
                : null;
            const principal = principalRoot?.entity ?? null;
            (entity as Record<string, unknown>)[relationship.navigationProperty] = principal;
            if (principalRoot) {
                this.fixOneToOneInverse(
                    entity,
                    principalRoot.entity,
                    relationship,
                );
                loadedPrincipals.push(principalRoot);
            }
            this.markLoaded(entity, relationship.navigationProperty);
        }

        const uniquePrincipals = uniqueIncludeRoots(loadedPrincipals);
        this.emitIncludeDiagnostic(metadata.entityName, principalMetadata.entityName, relationship.navigationProperty, 'splitQuery', roots.length, foreignKeyTuples.length, principals.length, uniquePrincipals.length, elapsed());
        return { metadata: principalMetadata, roots: uniquePrincipals };
    }

    private fixOneToOneInverse<TEntity extends object>(
        dependent: TEntity,
        principal: object,
        relationship: RelationshipMetadata<TEntity>,
    ): void {
        const inverse: unknown = relationship.inverseNavigationProperty;
        if (
            relationship.cardinality !== RelationshipCardinality.OneToOne ||
            typeof inverse !== 'string'
        ) {
            return;
        }
        const principalValues = principal as Record<string, unknown>;
        const existing = principalValues[inverse];
        if (existing && existing !== dependent) {
            throw new Error(
                `One-to-one relationship '${inverse}' matched more than one dependent entity.`,
            );
        }
        principalValues[inverse] = dependent;
        this.markLoaded(principal, inverse);
    }
}
