import type { EntityMetadata } from '../model/entity-metadata';
import type { RelationshipMetadata } from '../model/relationship-metadata';
import type { IncludeFilterModel } from './query-model';
import type { IncludeLoaderContext, LoadedIncludeResult, ManyToManyRelationshipInfo } from './include-loader-context';
import { IncludePropertyLoader } from './include-loader-key-batch';
import { IncludeStitcher } from './include-loader-stitch';
import { IncludeStrategyReference } from './include-strategy-reference';
import { IncludeStrategyOneToMany } from './include-strategy-one-to-many';
import { IncludeStrategyManyToMany } from './include-strategy-many-to-many';

/**
 * Choose the right eager-load strategy for one navigation and delegate to it.
 *
 * A single navigation resolves to one of three relationship kinds -- reference
 * (many-to-one), one-to-many, or many-to-many. This runner's one job is that
 * dispatch: it inspects the metadata to decide the kind (discovering the
 * dependent/related side via the `find*Relationship` helpers when the include
 * is declared through an inverse navigation) and forwards to the matching
 * `IncludeStrategy*` object, each of which owns its own batched / windowed /
 * per-parent execution. The strategies are built once here and share the
 * key-batching (`IncludePropertyLoader`) and stitching (`IncludeStitcher`)
 * collaborators, all wired from the read-only `IncludeLoaderContext`.
 */
export class IncludeStrategyRunner {
    private readonly reference: IncludeStrategyReference;
    private readonly oneToMany: IncludeStrategyOneToMany;
    private readonly manyToMany: IncludeStrategyManyToMany;

    constructor(private readonly ctx: IncludeLoaderContext) {
        const propertyLoader = new IncludePropertyLoader(ctx);
        const stitcher = new IncludeStitcher(ctx);
        this.reference = new IncludeStrategyReference(ctx, propertyLoader);
        this.oneToMany = new IncludeStrategyOneToMany(ctx, propertyLoader, stitcher);
        this.manyToMany = new IncludeStrategyManyToMany(ctx, stitcher);
    }

    public async loadDirectInclude<TEntity extends object>(
        metadata: EntityMetadata<TEntity>,
        entities: readonly TEntity[],
        navigationProperty: string,
        filter?: IncludeFilterModel,
    ): Promise<LoadedIncludeResult> {
        const manyToOne = metadata.relationships.find(item => item.navigationProperty === navigationProperty);
        if (manyToOne) {
            return this.reference.load(metadata, entities, manyToOne, filter);
        }

        const oneToMany = this.findOneToManyRelationship(metadata, navigationProperty);
        if (oneToMany) {
            return this.oneToMany.load(metadata, entities, oneToMany.dependentMetadata, oneToMany.relationship, filter);
        }

        const manyToMany = this.findManyToManyRelationship(metadata as unknown as EntityMetadata, navigationProperty);
        if (manyToMany) {
            return this.manyToMany.load(entities, manyToMany, filter);
        }

        throw new Error(`Include '${navigationProperty}' is not configured as a relationship on entity '${metadata.entityName}'.`);
    }

    private findManyToManyRelationship(
        currentMetadata: EntityMetadata,
        navigationProperty: string,
    ): ManyToManyRelationshipInfo | undefined {
        const direct = currentMetadata.manyToManyRelationships.find(item => item.navigationProperty === navigationProperty);
        if (direct) {
            return {
                currentMetadata,
                relatedMetadata: this.ctx.model.getEntity(direct.targetEntity),
                sourceMetadata: currentMetadata,
                relationship: direct,
                navigationProperty,
                currentJoinColumns: direct.sourceForeignKeyColumns,
                relatedJoinColumns: direct.targetForeignKeyColumns,
                relatedInverseNavigationProperty: direct.inverseNavigationProperty,
            };
        }

        for (const sourceMetadata of this.ctx.model.entities) {
            for (const relationship of sourceMetadata.manyToManyRelationships) {
                if (
                    relationship.targetEntity === currentMetadata.ctor &&
                    (relationship.inverseNavigationProperty as unknown) === navigationProperty
                ) {
                    return {
                        currentMetadata,
                        relatedMetadata: sourceMetadata,
                        sourceMetadata,
                        relationship: relationship,
                        navigationProperty,
                        currentJoinColumns: relationship.targetForeignKeyColumns,
                        relatedJoinColumns: relationship.sourceForeignKeyColumns,
                        relatedInverseNavigationProperty: relationship.navigationProperty,
                    };
                }
            }
        }

        return undefined;
    }

    private findOneToManyRelationship<TEntity extends object>(
        principalMetadata: EntityMetadata<TEntity>,
        navigationProperty: string,
    ): { dependentMetadata: EntityMetadata; relationship: RelationshipMetadata<object, TEntity> } | undefined {
        for (const dependentMetadata of this.ctx.model.entities) {
            for (const relationship of dependentMetadata.relationships) {
                if (
                    relationship.principalEntity === principalMetadata.ctor &&
                    (relationship.inverseNavigationProperty as unknown) === navigationProperty
                ) {
                    return {
                        dependentMetadata,
                        relationship: relationship as unknown as RelationshipMetadata<object, TEntity>,
                    };
                }
            }
        }

        return undefined;
    }
}
