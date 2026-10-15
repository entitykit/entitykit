import { cloneSnapshotValue } from '../packages/core/src/tracking/snapshot-value-clone';

function cyclicGraph(): Record<string, unknown> {
    const shared = { value: 7 };
    const graph: Record<string, unknown> = { first: shared, second: shared };
    graph.self = graph;
    graph.list = [graph, shared];
    graph.map = new Map([[shared, graph]]);
    graph.set = new Set([shared, graph]);
    return graph;
}

function expectOwnedGraph(copy: Record<string, unknown>, source: Record<string, unknown>): void {
    expect(copy).not.toBe(source);
    expect(copy.first).not.toBe(source.first);
    expect(copy.first).toBe(copy.second);
    expect(copy.self).toBe(copy);
    const list = copy.list as unknown[];
    const map = copy.map as Map<unknown, unknown>, set = copy.set as Set<unknown>;
    expect(list).not.toBe(source.list);
    expect(list).toHaveLength(2);
    expect(list[0]).toBe(copy);
    expect(list[1]).toBe(copy.first);
    expect(map).not.toBe(source.map);
    expect(map.size).toBe(1);
    expect(map.get(copy.first)).toBe(copy);
    expect(set).not.toBe(source.set);
    expect(set.size).toBe(2);
    expect(set.has(copy.first)).toBe(true);
    expect(set.has(copy)).toBe(true);
}

describe('snapshot native leaf observations', () => {
    it.each([false, true])('keeps reentrant Date captures independent: nested=%p', nested => {
        const graph = cyclicGraph();
        const captures: Array<Record<string, unknown>> = [];
        const date = new Date(123);
        date.getTime = function (): number {
            expect(this).toBe(date);
            captures.push(cloneSnapshotValue(graph) as typeof graph);
            return 456;
        };
        const source = nested ? { date } : date;

        const first = cloneSnapshotValue(source) as Date | { date: Date };
        const second = cloneSnapshotValue(source) as Date | { date: Date };
        const firstDate = first instanceof Date ? first : first.date;
        const secondDate = second instanceof Date ? second : second.date;

        expect(firstDate.getTime()).toBe(456);
        expect(secondDate.getTime()).toBe(456);
        expect(firstDate).not.toBe(date);
        expect(firstDate).not.toBe(secondDate);
        expect(captures).toHaveLength(2);
        for (const capture of captures) expectOwnedGraph(capture, graph);
        expect(captures[0].first).not.toBe(captures[1].first);
    });

    it.each([false, true])('copies bytes before observing a reentrant constructor: nested=%p', nested => {
        const graph = cyclicGraph();
        const captures: Array<Record<string, unknown>> = [];
        const events: string[] = [];
        const source = new Uint8Array([9, 1, 2, 8]).subarray(1, 3);
        class OwnedBytes extends Uint8Array {
            constructor(buffer: ArrayBuffer) {
                events.push('construct');
                super(buffer);
            }
        }
        Object.defineProperty(source, 'constructor', {
            get(): typeof OwnedBytes {
                events.push('constructor');
                captures.push(cloneSnapshotValue(graph) as typeof graph);
                source[0] = 77;
                return OwnedBytes;
            },
        });

        const result = cloneSnapshotValue(nested ? { source } : source) as Uint8Array | { source: Uint8Array };
        const copy = result instanceof Uint8Array ? result : result.source;

        expect(events).toEqual(['constructor', 'construct']);
        expect(copy).toBeInstanceOf(OwnedBytes);
        expect([...copy]).toEqual([1, 2]);
        expect([...source]).toEqual([77, 2]);
        expect(copy.buffer).not.toBe(source.buffer);
        expect(copy.byteOffset).toBe(0);
        expect(copy.buffer.byteLength).toBe(2);
        expect(captures).toHaveLength(1);
        expectOwnedGraph(captures[0], graph);
    });

    it('preserves independent native copies alongside shared cyclic graph nodes', () => {
        const graph = cyclicGraph();
        const date = new Date(123), bytes = new Uint8Array([4, 5]);
        graph.dates = [date, date];
        graph.bytes = [bytes, bytes];

        const copy = cloneSnapshotValue(graph) as typeof graph;
        const dates = copy.dates as Date[], copies = copy.bytes as Uint8Array[];

        expectOwnedGraph(copy, graph);
        expect(dates[0]).not.toBe(date);
        expect(dates[0]).not.toBe(dates[1]);
        expect(dates.map(value => value.getTime())).toEqual([123, 123]);
        expect(copies[0]).not.toBe(bytes);
        expect(copies[0]).not.toBe(copies[1]);
        expect(copies[0].buffer).not.toBe(copies[1].buffer);
        dates[0].setTime(999);
        copies[0][0] = 99;
        expect(dates[1].getTime()).toBe(123);
        expect([...copies[1]]).toEqual([4, 5]);
        expect([...bytes]).toEqual([4, 5]);
    });

    it('keeps constructor failures isolated from a later capture', () => {
        const failure = new Error('native constructor lookup failed');
        const source = new Uint8Array([3, 4]);
        let attempts = 0;
        Object.defineProperty(source, 'constructor', {
            get(): Uint8ArrayConstructor {
                if (++attempts === 1) throw failure;
                return Uint8Array;
            },
        });

        expect(() => cloneSnapshotValue(source)).toThrow(failure);
        const copy = cloneSnapshotValue(source) as Uint8Array;

        expect(attempts).toBe(2);
        expect(copy).not.toBe(source);
        expect([...copy]).toEqual([3, 4]);
        copy[0] = 99;
        expect([...source]).toEqual([3, 4]);
    });
});
