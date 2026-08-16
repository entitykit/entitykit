import type { IncludeLoaderContext } from './include-loader-context';

/**
 * The one place an include changes an entry's loaded-navigation facts.
 *
 * Flagging a navigation loaded also clears its change-detection suppression and
 * re-captures its baseline, so the entry is recorded as a participant in this
 * load *before* the flag moves: whoever the entry belongs to -- a root, an
 * inverse principal, a related entity, or an instance attached while the load
 * was in flight and then resolved from the identity map -- a failed load hands
 * back the facts it found rather than the ones it was part-way through writing.
 */
export function markIncludeNavigationLoaded(
    ctx: IncludeLoaderContext,
    entity: object,
    navigationProperty: string,
    boundValues?: Readonly<Record<string, unknown>>,
): void {
    const entry = ctx.changeTracker.entry(entity);
    if (!entry) return;
    ctx.trackerJournal.touch(entry);
    entry.markNavigationLoaded(navigationProperty, boundValues);
}
