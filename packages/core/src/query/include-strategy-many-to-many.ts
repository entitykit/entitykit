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
import { includeKeyStatements } from './include-key-statements';
import type { SqlStatement } from '../sql/sql-statement';

/**
 * Many-to-many eager load across a join table.
 *
 * Batch disjoint current-key sets through the join table, then stitch once.
 * Limits use per-parent windows for single keys on window-capable providers;
 * other shapes retain the per-entity fallback. Window bindings and SELECTs
 * place parent keys before related columns: positional order must match SQL.
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
        const statements = includeKeyStatements(
            this.ctx.dialect, currentKeys, info.currentJoinColumns.length,
            keys => buildManyToManyBatchStatement(
                this.ctx.dialect, this.ctx.applyQueryFilters, info, keys, filter,
            ),
        );
        const loaded = await this.loadStatements(statements, currentEntities, info);
        if (emitDiagnostic) {
            this.emitIncludeDiagnostic(info.currentMetadata.entityName, info.relatedMetadata.entityName, info.navigationProperty, 'splitQuery', currentEntities.length, currentKeys.length, loaded.rowCount, loaded.roots.length, elapsed());
        }
        return { metadata: info.relatedMetadata, roots: loaded.roots };
    }

    private async loadWindowedBatch(
        currentKeys: ReadonlyArray<readonly unknown[]>,
        currentEntities: readonly IncludeLoadRoot[],
        info: ManyToManyRelationshipInfo,
        filter: IncludeFilterModel,
    ): Promise<LoadedIncludeResult> {
        const elapsed = startElapsedTimer();
        const statements = includeKeyStatements(
            this.ctx.dialect, currentKeys, 1,
            keys => buildManyToManyWindowStatement(
                this.ctx.dialect, this.ctx.applyQueryFilters, info, keys, filter,
            ),
        );
        const loaded = await this.loadStatements(statements, currentEntities, info);
        this.emitIncludeDiagnostic(info.currentMetadata.entityName, info.relatedMetadata.entityName, info.navigationProperty, 'windowedBatch', currentEntities.length, currentKeys.length, loaded.rowCount, loaded.roots.length, elapsed());
        return { metadata: info.relatedMetadata, roots: loaded.roots };
    }

    private async loadStatements(
        statements: Iterable<SqlStatement>,
        currentEntities: readonly IncludeLoadRoot[],
        info: ManyToManyRelationshipInfo,
    ): Promise<{ roots: IncludeLoadRoot[]; rowCount: number }> {
        const rows: Array<Record<string, unknown>> = [];
        const roots: IncludeLoadRoot[] = [];
        let rowCount = 0;
        for (const statement of statements) {
            const result = await this.ctx.database.query(statement, this.ctx.operationOptions);
            rowCount += result.rowCount;
            for (const row of result.rows) rows.push(row);
            const materialized = this.ctx.materializer.materializeManyWithValues(
                info.relatedMetadata, result.rows, this.ctx.changeTracker,
            );
            for (const root of materialized) roots.push(root);
        }
        return { roots: this.stitcher.assignManyToManyRelated(rows, roots, currentEntities, info), rowCount };
    }
}
