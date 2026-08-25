/** Stable dependency ordering without rescanning and sorting every node. */
export function stableTopologicalOrder<TEntry extends object>(
    entries: readonly TEntry[],
    outgoing: ReadonlyMap<TEntry, ReadonlySet<TEntry>>,
    incoming: Map<TEntry, number>,
    compare: (left: TEntry, right: TEntry) => number,
): TEntry[] {
    const remaining = new Set(entries);
    const inputRank: Map<TEntry, number> = new Map();
    entries.forEach((entry, index) => {
        if (!inputRank.has(entry)) inputRank.set(entry, index);
    });
    const stableCompare = (left: TEntry, right: TEntry): number =>
        compare(left, right) ||
        (inputRank.get(left) ?? 0) - (inputRank.get(right) ?? 0);
    const ready = new BinaryMinHeap(stableCompare);
    const fallback = new BinaryMinHeap(stableCompare);
    const ordered: TEntry[] = [];

    for (const entry of entries) {
        fallback.push(entry);
        if ((incoming.get(entry) ?? 0) === 0) ready.push(entry);
    }

    while (remaining.size > 0) {
        // Cyclic graphs have no ready node. Break the cycle deterministically
        // and let the provider enforce any irreducible constraint.
        const next = takeRemaining(ready, remaining) ??
            takeRemaining(fallback, remaining);
        if (!next) throw new Error('Save dependency graph lost a tracked entry.');
        remaining.delete(next);
        ordered.push(next);
        for (const dependent of outgoing.get(next) ?? []) {
            const count = (incoming.get(dependent) ?? 0) - 1;
            incoming.set(dependent, count);
            if (count === 0 && remaining.has(dependent)) ready.push(dependent);
        }
    }

    return ordered;
}

function takeRemaining<TEntry extends object>(
    heap: BinaryMinHeap<TEntry>,
    remaining: ReadonlySet<TEntry>,
): TEntry | undefined {
    while (!heap.isEmpty) {
        const next = heap.pop();
        if (remaining.has(next)) return next;
    }
    return undefined;
}

class BinaryMinHeap<TEntry> {
    private readonly items: TEntry[] = [];

    constructor(
        private readonly compare: (left: TEntry, right: TEntry) => number,
    ) {}

    public get isEmpty(): boolean {
        return this.items.length === 0;
    }

    public push(entry: TEntry): void {
        this.items.push(entry);
        let index = this.items.length - 1;
        while (index > 0) {
            const parent = Math.floor((index - 1) / 2);
            if (this.compare(this.items[parent], entry) <= 0) break;
            this.items[index] = this.items[parent];
            index = parent;
        }
        this.items[index] = entry;
    }

    public pop(): TEntry {
        const first = this.items[0];
        const last = this.items.pop();
        if (first === undefined || last === undefined) {
            throw new Error('Cannot remove an entry from an empty heap.');
        }
        if (this.items.length === 0) return first;

        let index = 0;
        while (index < this.items.length) {
            const left = index * 2 + 1;
            const right = left + 1;
            if (left >= this.items.length) break;
            const child = right < this.items.length &&
                this.compare(this.items[right], this.items[left]) < 0
                ? right
                : left;
            if (this.compare(last, this.items[child]) <= 0) break;
            this.items[index] = this.items[child];
            index = child;
        }
        this.items[index] = last;
        return first;
    }
}
