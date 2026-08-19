import type { EntityEntry } from '../tracking/entity-entry';

/** Deduplicate one entry/navigation pair and serialize distinct context loads. */
export class LazyLoadScheduler {
    private readonly pending: WeakMap<
        EntityEntry<object>,
        Map<string, Promise<unknown>>
    > = new WeakMap();
    private tail: Promise<void> = Promise.resolve();

    public get(
        entry: EntityEntry<object>,
        navigationProperty: string,
    ): Promise<unknown> | undefined {
        return this.pending.get(entry)?.get(navigationProperty);
    }

    public async schedule(
        entry: EntityEntry<object>,
        navigationProperty: string,
        load: () => Promise<unknown>,
    ): Promise<unknown> {
        const entryLoads = this.pending.get(entry)
            ?? new Map<string, Promise<unknown>>();
        this.pending.set(entry, entryLoads);
        const result = this.tail.then(load);
        this.tail = result.then(() => undefined, () => undefined);
        const tracked = result.finally(() => {
            entryLoads.delete(navigationProperty);
            if (entryLoads.size === 0) {
                this.pending.delete(entry);
            }
        });
        entryLoads.set(navigationProperty, tracked);
        return tracked;
    }
}
