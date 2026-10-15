import { cloneSnapshotValue } from '../packages/core/src/tracking/snapshot-value-clone';

describe('binary snapshot allocation boundaries', () => {
    it.each(['typed', 'buffer', 'data-view'])('zero-fills a partial copy for %s', kind => {
        const backing = Uint8Array.from([9, 1, 2, 8]).buffer;
        const source = kind === 'buffer' ? Buffer.from(backing, 1, 2)
            : kind === 'data-view' ? new DataView(backing, 1, 2)
                : new Uint8Array(backing, 1, 2);
        const events: string[] = [];
        let lengths = 0;
        Object.defineProperties(source, {
            byteLength: { get: (): number => {
                events.push('length'); return ++lengths === 1 ? 5 : 2;
            } },
            buffer: { get: (): ArrayBuffer => {
                events.push('buffer'); return backing;
            } },
            byteOffset: { get: (): number => {
                events.push('offset'); return 1;
            } },
            constructor: { get: (): typeof Uint8Array | typeof Buffer => {
                events.push('constructor');
                if (kind === 'data-view') throw new Error('Unexpected DataView constructor lookup');
                return kind === 'buffer' ? Buffer : Uint8Array;
            } },
        });

        const result = cloneSnapshotValue(source) as ArrayBufferView;

        expect(events).toEqual(kind === 'data-view'
            ? ['length', 'buffer', 'offset', 'length']
            : ['length', 'buffer', 'offset', 'length', 'constructor']);
        expect(Object.getPrototypeOf(result)).toBe(Object.getPrototypeOf(source));
        expect(result.buffer).not.toBe(backing);
        expect(result.byteOffset).toBe(0);
        expect(result.buffer.byteLength).toBe(5);
        expect([...new Uint8Array(result.buffer)]).toEqual([1, 2, 0, 0, 0]);
        new Uint8Array(backing).fill(7);
        expect([...new Uint8Array(result.buffer)]).toEqual([1, 2, 0, 0, 0]);
    });

    it('refuses an oversized later source view before reading its constructor', () => {
        const source = new Uint8Array([1, 2, 3]);
        let lengths = 0, constructors = 0;
        Object.defineProperties(source, {
            byteLength: { get: (): number => ++lengths === 1 ? 1 : 3 },
            constructor: { get: (): Uint8ArrayConstructor => {
                constructors++; return Uint8Array;
            } },
        });

        expect(() => cloneSnapshotValue(source)).toThrow('offset is out of bounds');
        expect(lengths).toBe(2);
        expect(constructors).toBe(0);
    });
});
