import type { IncludeLoaderContext, IncludeLoadRoot, LoadedIncludeResult, ManyToManyRelationshipInfo } from './include-loader-context';
import type { IncludeStitcher } from './include-loader-stitch';
import { IncludeStrategyBase } from './include-strategy-base';
import { buildManyToManyBatchStatement } from './include-many-to-many-batch-sql';
import { buildManyToManyWindowStatement } from './include-many-to-many-window-sql';
import { isCompleteTuple } from './include-key-helpers';
import { uniquePropertyTuples } from './include-property-key-helpers';
import { uniqueIncludeRoots } from './include-load-root';
import type { IncludeFilterModel } from './query-model';
import { startElapsedTimer } from '../diagnostics/runtime/elapsed-time';
import { boundQueryTuple } from './include-bound-key';

/**
 * Many-to-many eager load across a join table.
 *
 * The batched path joins the related table through the join table in one query,
 * binds the current keys, and lets the stitcher fan the rows back out onto the
 * current entities. As with one-to-many, an include-level limit/offset needs
 * either a per-parent window (single join column, a window-capable provider) or
 * the per-entity fallback (composite key / provider without window functions).
 * The critical detail this class
 * guards is parameter-binding order: unlike one-to-many, the windowed variant
 * converts and binds the current keys directly via `parameters.add(...)` up
 * front and lists the parent key *before* the entity columns in the inner
 * SELECT. Preserve that sequence -- positional bind order must match the SQL.
 */
export class IncludeStrategyManyToMany extends IncludeStrategyBase {
    constructor(ctx: IncludeLoaderContext, private readonly stitcher: IncludeStitcher) {
        super(ctx);
    }

    public async load(
        currentEntities: readonly IncludeLoadRoot[],
        info: ManyToManyRelationshipInfo,
        filter?: IncludeFilterModel,
    ): Promise<LoadedIncludeResult> {
        const elapsed = startElapsedTimer();
        const currentKeys = uniquePropertyTuples(
            info.currentMetadata,
            info.currentMetadata.keyProperties.map(String),
            currentEntities
                .map(root => boundQueryTuple(
                    info.currentMetadata.keyProperties.map(
                        propertyName => root.boundValues[propertyName],
                    ),
                ))
                .filter(isCompleteTuple),
        );

        if (currentKeys.length === 0) {
            for (const { entity } of currentEntities) {
                this.ctx.journal.write(entity, info.navigationProperty, [], info.currentMetadata.entityName);
                this.markLoaded(entity, info.navigationProperty);
            }
            this.emitIncludeDiagnostic(info.currentMetadata.entityName, info.relatedMetadata.entityName, info.navigationProperty, 'skipped', currentEntities.length, 0, 0, 0, elapsed());
            return { metadata: info.relatedMetadata, roots: [] };
        }

        if (currentEntities.length > 1 && (filter?.limit !== undefined || filter?.offset !== undefined)) {
            // The windowed batch partitions by a single join column and needs
            // `row_number()`, so a composite key or a provider without window
            // functions uses the per-entity path instead: slower, but correct.
            if (this.ctx.dialect.supportsWindowFunctions?.() === true && info.currentJoinColumns.length === 1) {
                return this.loadWindowedBatch(currentKeys, currentEntities, info, filter);
            }
            return this.loadPerCurrentEntity(currentEntities, info, filter);
        }

        return this.loadBatch(currentKeys, currentEntities, info, filter);
    }

    private async loadPerCurrentEntity(
        currentEntities: readonly IncludeLoadRoot[],
        info: ManyToManyRelationshipInfo,
        filter: IncludeFilterModel,
    ): Promise<LoadedIncludeResult> {
        const elapsed = startElapsedTimer();
        const allRelated: IncludeLoadRoot[] = [];

        for (const root of currentEntities) {
            const currentKey = boundQueryTuple(
                info.currentMetadata.keyProperties.map(
                    propertyName => root.boundValues[propertyName],
                ),
            );
            const loaded = await this.loadBatch([currentKey], [root], info, filter, false);
            allRelated.push(...loaded.roots);
        }

        const uniqueRelated = uniqueIncludeRoots(allRelated);
        this.emitIncludeDiagnostic(info.currentMetadata.entityName, info.relatedMetadata.entityName, info.navigationProperty, 'perParentFallback', currentEntities.length, currentEntities.length, allRelated.length, uniqueRelated.length, elapsed());
        return { metadata: info.relatedMetadata, roots: uniqueRelated };
    }

    private async loadBatch(
        currentKeys: ReadonlyArray<readonly unknown[]>,
        currentEntities: readonly IncludeLoadRoot[],
        info: ManyToManyRelationshipInfo,
        filter?: IncludeFilterModel,
        emitDiagnostic = true,
    ): Promise<LoadedIncludeResult> {
        const elapsed = startElapsedTimer();
        const statement = buildManyToManyBatchStatement(
            this.ctx.dialect,
            this.ctx.applyQueryFilters,
            info,
            currentKeys,
            filter,
        );
        const result = await this.ctx.database.query(
            statement,
            this.ctx.operationOptions,
        );
        const relatedRoots = this.ctx.materializer.materializeManyWithValues(info.relatedMetadata, result.rows, this.ctx.changeTracker);
        const uniqueRelated = this.stitcher.assignManyToManyRelated(result.rows, relatedRoots, currentEntities, info);
        if (emitDiagnostic) {
            this.emitIncludeDiagnostic(info.currentMetadata.entityName, info.relatedMetadata.entityName, info.navigationProperty, 'splitQuery', currentEntities.length, currentKeys.length, result.rowCount, uniqueRelated.length, elapsed());
        }
        return { metadata: info.relatedMetadata, roots: uniqueRelated };
    }

    private async loadWindowedBatch(
        currentKeys: ReadonlyArray<readonly unknown[]>,
        currentEntities: readonly IncludeLoadRoot[],
        info: ManyToManyRelationshipInfo,
        filter: IncludeFilterModel,
    ): Promise<LoadedIncludeResult> {
        const elapsed = startElapsedTimer();
        const statement = buildManyToManyWindowStatement(
            this.ctx.dialect,
            this.ctx.applyQueryFilters,
            info,
            currentKeys,
            filter,
        );
        const result = await this.ctx.database.query(
            statement,
            this.ctx.operationOptions,
        );
        const relatedRoots = this.ctx.materializer.materializeManyWithValues(info.relatedMetadata, result.rows, this.ctx.changeTracker);
        const uniqueRelated = this.stitcher.assignManyToManyRelated(result.rows, relatedRoots, currentEntities, info);
        this.emitIncludeDiagnostic(info.currentMetadata.entityName, info.relatedMetadata.entityName, info.navigationProperty, 'windowedBatch', currentEntities.length, currentKeys.length, result.rowCount, uniqueRelated.length, elapsed());
        return { metadata: info.relatedMetadata, roots: uniqueRelated };
    }
}
