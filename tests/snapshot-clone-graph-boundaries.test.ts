import { cloneSnapshotValue } from '../packages/core/src/tracking/snapshot-value-clone';
import { requireDefined } from './support/require-defined';

interface GraphNode {
    value: number;
    next?: GraphNode;
    back?: GraphNode;
}

function ring(count: number, read?: (index: number) => void): GraphNode[] {
    const nodes: GraphNode[] = Array.from({ length: count }, (_, value) => ({ value }));
    for (let index = 0; index < count; index++) {
        nodes[index].next = nodes[(index + 1) % count];
        nodes[index].back = nodes[(index + count - 1) % count];
        Object.defineProperty(nodes[index], 'value', {
            enumerable: true, configurable: true,
            get: () => {
                read?.(index);return index;
            },
        });
    }
    return nodes;
}

function inspectRing(copy: GraphNode, originals: GraphNode[]): GraphNode[] {
    const copies: GraphNode[] = [];
    let cursor = copy;
    for (const original of originals) {
        expect(cursor).not.toBe(original);
        copies.push(cursor);
        cursor = requireDefined(cursor.next);
    }
    expect(cursor).toBe(copy);
    for (let index = 0; index < copies.length; index++) {
        expect(copies[index].value).toBe(index);
        expect(copies[index].back).toBe(copies[(index + copies.length - 1) % copies.length]);
    }
    return copies;
}

describe('snapshot clone graph boundaries', () => {
    it.each([1, 2, 7, 8, 9, 16, 64])('preserves every reference and getter order in a %i-node ring', count => {
        const reads: number[] = [], originals = ring(count, index => reads.push(index));
        const first = cloneSnapshotValue(originals[0]) as GraphNode;
        expect(reads).toEqual(Array.from({ length: count }, (_, index) => index));
        reads.length = 0;
        const second = cloneSnapshotValue(originals[0]) as GraphNode;
        expect(reads).toEqual(Array.from({ length: count }, (_, index) => index));
        const firstNodes = inspectRing(first, originals), secondNodes = inspectRing(second, originals);
        for (let index = 0; index < count; index++) {
            expect(firstNodes[index]).not.toBe(secondNodes[index]);
            firstNodes[index].value = -1;
            expect(secondNodes[index].value).toBe(index);
            expect(originals[index].value).toBe(index);
        }
    });

    it.each([3, 4, 5, 12])('preserves Map/Set links across a graph with %i child nodes', count => {
        const items = ring(count);
        interface Graph {
            items: GraphNode[];
            map: Map<unknown, unknown>;
            set: Set<unknown>;
            self?: Graph;
        }
        const source: Graph = { items, map: new Map(), set: new Set() };
        source.self = source;
        source.map.set(items[0], source.set);source.map.set(source.map, source);
        source.set.add(source.map);source.set.add(items[count - 1]);source.set.add(source);
        const copy = cloneSnapshotValue(source) as Graph;
        expect(copy).not.toBe(source);expect(copy.items).not.toBe(items);
        expect(copy.map).not.toBe(source.map);expect(copy.set).not.toBe(source.set);
        expect(copy.self).toBe(copy);
        expect(copy.map.get(copy.items[0])).toBe(copy.set);
        expect(copy.map.get(copy.map)).toBe(copy);
        expect(copy.set.size).toBe(3);expect(copy.map.size).toBe(2);
        expect(copy.set.has(copy.map)).toBe(true);
        expect(copy.set.has(copy.items[count - 1])).toBe(true);
        expect(copy.set.has(copy)).toBe(true);
        const chain = inspectRing(copy.items[0], items);
        for (let index = 0; index < count; index++) expect(chain[index]).toBe(copy.items[index]);
    });

    it('keeps late failures and reentrant copies isolated from the next attempt', () => {
        const failure = new Error('late snapshot getter failed');
        let fail = true;
        const independent = ring(9), nested: GraphNode[] = [];
        const originals = ring(16, index => {
            if (index === 9) {
                nested.push(cloneSnapshotValue(independent[0]) as GraphNode);
                if (fail) throw failure;
            }
        });
        expect(() => cloneSnapshotValue(originals[0])).toThrow(failure);
        fail = false;
        const recovered = cloneSnapshotValue(originals[0]) as GraphNode;
        inspectRing(recovered, originals);
        expect(nested).toHaveLength(2);
        inspectRing(nested[0], independent);inspectRing(nested[1], independent);
        expect(nested[0]).not.toBe(nested[1]);
        expect(nested[0]).not.toBe(recovered);
    });

    it('keeps own bookkeeping isolated from inherited record setters and read-only fields', () => {
        const names = ['source1', 'copy1', 'size', 'indexed'];
        const descriptors = names.map(name => Object.getOwnPropertyDescriptor(Object.prototype, name));
        let writes = 0;
        const source = Object.defineProperty({}, 'child', {
            enumerable: true,
            get: () => {
                for (const name of names) Object.defineProperty(Object.prototype, name, {
                    configurable: true, set: () => {
                        writes++; 
                    },
                });
                Object.defineProperty(Object.prototype, 'copy2', { configurable: true, writable: false, value: 0 });
                return { source1: { copy1: 1 }, copy2: 2 };
            },
        });
        const copy2 = Object.getOwnPropertyDescriptor(Object.prototype, 'copy2');
        let copy: unknown;
        try {
            copy = cloneSnapshotValue(source);
        } finally {
            names.forEach((name, index) => {
                const descriptor = descriptors[index];
                if (descriptor) Object.defineProperty(Object.prototype, name, descriptor);
                else Reflect.deleteProperty(Object.prototype, name);
            });
            if (copy2) Object.defineProperty(Object.prototype, 'copy2', copy2);
            else Reflect.deleteProperty(Object.prototype, 'copy2');
        }
        expect(writes).toBe(0);
        expect(copy).toEqual({ child: { source1: { copy1: 1 }, copy2: 2 } });
    });

    it('does not introduce private array-index writes while cloning ordinary records', () => {
        const index = Object.getOwnPropertyDescriptor(Array.prototype, '0');
        const length = requireDefined(Object.getOwnPropertyDescriptor(Array.prototype, 'length'));
        let writes = 0;
        const source = Object.defineProperty({}, 'child', {
            enumerable: true,
            get: () => {
                Object.defineProperty(Array.prototype, '0', { configurable: true, set: () => {
                    writes++; 
                } });
                return { nested: { value: 1 } };
            },
        });
        let copy: unknown;
        try {
            copy = cloneSnapshotValue(source);
        } finally {
            if (index) Object.defineProperty(Array.prototype, '0', index);
            else Reflect.deleteProperty(Array.prototype, '0');
            Object.defineProperty(Array.prototype, 'length', length);
        }
        expect(writes).toBe(0);
        expect(copy).toEqual({ child: { nested: { value: 1 } } });
    });
});
