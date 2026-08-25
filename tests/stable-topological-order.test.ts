import { stableTopologicalOrder } from '../packages/core/src/core/save-plan/stable-topological-order';

interface Node {
    readonly id: string;
    readonly priority: number;
    readonly index: number;
}

function order(
    entries: readonly Node[],
    edges: ReadonlyArray<readonly [Node, Node]>,
    compare: (left: Node, right: Node) => number = compareNodes,
): Node[] {
    const outgoing = new Map(entries.map(entry => [entry, new Set<Node>()]));
    const incoming = new Map(entries.map(entry => [entry, 0]));
    for (const [before, after] of edges) {
        outgoing.get(before)?.add(after);
        incoming.set(after, (incoming.get(after) ?? 0) + 1);
    }
    return stableTopologicalOrder(entries, outgoing, incoming, compare);
}

function compareNodes(left: Node, right: Node): number {
    return left.priority - right.priority || left.index - right.index;
}

function referenceOrder(
    entries: readonly Node[],
    edges: ReadonlyArray<readonly [Node, Node]>,
): Node[] {
    const remaining = new Set(entries);
    const outgoing = new Map(entries.map(entry => [entry, new Set<Node>()]));
    const incoming = new Map(entries.map(entry => [entry, 0]));
    const ordered: Node[] = [];
    for (const [before, after] of edges) {
        outgoing.get(before)?.add(after);
        incoming.set(after, (incoming.get(after) ?? 0) + 1);
    }
    while (remaining.size > 0) {
        const ready = [...remaining]
            .filter(entry => (incoming.get(entry) ?? 0) === 0)
            .sort(compareNodes);
        const next = ready[0] ?? [...remaining].sort(compareNodes)[0];
        remaining.delete(next);
        ordered.push(next);
        for (const dependent of outgoing.get(next) ?? []) {
            incoming.set(dependent, (incoming.get(dependent) ?? 0) - 1);
        }
    }
    return ordered;
}

describe('stable topological ordering', () => {
    it('uses stable priority among ready entries without violating dependencies', () => {
        const first = { id: 'first', priority: 1, index: 0 };
        const dependent = { id: 'dependent', priority: 0, index: 1 };
        const ready = { id: 'ready', priority: 0, index: 2 };

        expect(order(
            [first, dependent, ready],
            [[first, dependent]],
        ).map(entry => entry.id)).toEqual(['ready', 'first', 'dependent']);
    });

    it('breaks a cycle by the same stable priority used for ready entries', () => {
        const deleted = { id: 'deleted', priority: 2, index: 0 };
        const added = { id: 'added', priority: 1, index: 1 };
        const modified = { id: 'modified', priority: 0, index: 2 };

        expect(order(
            [deleted, added, modified],
            [[modified, added], [added, deleted], [deleted, modified]],
        ).map(entry => entry.id)).toEqual(['modified', 'added', 'deleted']);
    });

    it('preserves input order when the caller considers entries equal', () => {
        const entries = Array.from({ length: 100 }, (_, index) => ({
            id: `entry_${String(index)}`,
            priority: 0,
            index,
        }));

        expect(order(entries, [], () => 0)).toEqual(entries);
    });

    it('keeps the first position of a repeated entry reference', () => {
        const first = { id: 'first', priority: 0, index: 0 };
        const second = { id: 'second', priority: 0, index: 1 };

        expect(order([first, second, first], [], () => 0))
            .toEqual([first, second]);
    });

    it('matches the previous stable selection for every four-node graph', () => {
        const entries = [
            { id: 'a', priority: 2, index: 0 },
            { id: 'b', priority: 0, index: 1 },
            { id: 'c', priority: 1, index: 2 },
            { id: 'd', priority: 0, index: 3 },
        ];
        const possibleEdges = entries.flatMap(before =>
            entries.flatMap(after => before === after
                ? []
                : [[before, after] as const]));

        for (let mask = 0; mask < 2 ** possibleEdges.length; mask++) {
            const edges = possibleEdges.filter(
                (_edge, index) => Boolean(mask & 1 << index),
            );
            expect(order(entries, edges)).toEqual(referenceOrder(entries, edges));
        }
    });

    it('keeps ready selection sub-quadratic at provider-contract scale', () => {
        const entries = Array.from({ length: 12_000 }, (_, index) => ({
            id: `entry_${String(index)}`,
            priority: index % 3,
            index,
        }));
        let comparisons = 0;
        const ordered = order(entries, [], (left, right) => {
            comparisons += 1;
            return compareNodes(left, right);
        });

        expect(ordered).toEqual([...entries].sort(compareNodes));
        expect(comparisons).toBeLessThan(1_000_000);
    });
});
