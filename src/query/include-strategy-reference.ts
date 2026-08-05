import type { EntityMetadata } from '../model/entity-metadata';
import type { RelationshipMetadata } from '../model/relationship-metadata';
import type { IncludeFilterModel } from './query-model';
import type { IncludeLoaderContext, LoadedIncludeResult } from './include-loader-context';
import type { IncludePropertyLoader } from './include-loader-key-batch';
import { IncludeStrategyBase } from './include-strategy-base';
import { isCompleteTuple } from './include-key-helpers';
import { uniquePropertyTuples } from './include-property-key-helpers';
import { uniqueEntityInstances } from './include-navigation-helpers';
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
        entities: readonly TEntity[],
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
            entities
                .map(entity => dependentValuesForPrincipal(
                    relationship,
                    metadata,
                    principalMetadata,
                    entity as Record<string, unknown>,
                ))
                .filter(isCompleteTuple),
        );

        if (foreignKeyTuples.length === 0) {
            for (const entity of entities) {
                (entity as Record<string, unknown>)[relationship.navigationProperty] = null;
                this.markLoaded(entity, relationship.navigationProperty);
            }
            this.emitIncludeDiagnostic(metadata.entityName, principalMetadata.entityName, relationship.navigationProperty, 'skipped', entities.length, 0, 0, 0, elapsed());
            return { metadata: principalMetadata, entities: [] };
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
                    principal as Record<string, unknown>,
                ),
                principal,
            ]),
        );
        const loadedPrincipals: object[] = [];

        for (const entity of entities) {
            const foreignKeyTuple = foreignKeyProperties.map(propertyName => (entity as Record<string, unknown>)[propertyName]);
            const principal = isCompleteTuple(foreignKeyTuple)
                ? principalsByKey.get(dependentRelationshipProviderKey(
                    relationship,
                    metadata,
                    entity as Record<string, unknown>,
                )) ?? null
                : null;
            (entity as Record<string, unknown>)[relationship.navigationProperty] = principal;
            if (principal) {
                this.fixOneToOneInverse(entity, principal, relationship);
                loadedPrincipals.push(principal);
            }
            this.markLoaded(entity, relationship.navigationProperty);
        }

        const uniquePrincipals = uniqueEntityInstances(loadedPrincipals);
        this.emitIncludeDiagnostic(metadata.entityName, principalMetadata.entityName, relationship.navigationProperty, 'splitQuery', entities.length, foreignKeyTuples.length, principals.length, uniquePrincipals.length, elapsed());
        return { metadata: principalMetadata, entities: uniquePrincipals };
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
