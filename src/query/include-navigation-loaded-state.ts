import type { IncludeLoaderContext } from './include-loader-context';

export function markIncludeNavigationLoaded(
    ctx: IncludeLoaderContext,
    entity: object,
    navigationProperty: string,
    boundValues?: Readonly<Record<string, unknown>>,
): void {
    ctx.changeTracker.entry(entity)?.markNavigationLoaded(
        navigationProperty, boundValues,
    );
}
