import type { IncludeDiagnosticEvent } from '../diagnostics/runtime/events';
import type { IncludeLoaderContext } from './include-loader-context';
import { markIncludeNavigationLoaded } from './include-navigation-loaded-state';

/**
 * Shared foundation for the per-kind eager-load strategies.
 *
 * Every include strategy -- reference, one-to-many, many-to-many -- ends with
 * the same two cross-cutting bookkeeping steps: flag the navigation as loaded
 * on the change tracker so it is not lazily re-fetched, and emit the timing
 * diagnostic that records which strategy actually ran. Both depend only on the
 * shared read-only `IncludeLoaderContext`, so they live here once instead of
 * being copied into each strategy. Concrete strategies extend this and receive
 * whatever extra loader collaborators they need (key batcher, stitcher)
 * explicitly through their own constructors rather than reaching back into the
 * runner that owns them.
 */
export abstract class IncludeStrategyBase {
    constructor(protected readonly ctx: IncludeLoaderContext) {}

    protected markLoaded(
        entity: object,
        navigationProperty: string,
        boundValues?: Readonly<Record<string, unknown>>,
    ): void {
        markIncludeNavigationLoaded(
            this.ctx, entity, navigationProperty, boundValues,
        );
    }

    protected emitIncludeDiagnostic(
        parentEntityName: string,
        relatedEntityName: string,
        navigationProperty: string,
        strategy: IncludeDiagnosticEvent['strategy'],
        parentCount: number,
        keyCount: number,
        rowCount: number,
        loadedCount: number,
        durationMs: number,
    ): void {
        this.ctx.diagnostics?.({
            parentEntityName,
            relatedEntityName,
            navigationProperty,
            strategy,
            parentCount,
            keyCount,
            rowCount,
            loadedCount,
            durationMs,
        });
    }
}
