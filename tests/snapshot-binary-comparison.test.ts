import { snapshotValuesEqual } from '../packages/core/src/tracking/snapshot-value-equality';

describe('binary snapshot comparison boundaries', () => {
    it.each([0, 1, 32, 48, 64, 4096])('compares visible bytes, including mismatch positions, for length %s', length => {
        const leftBacking = Uint8Array.from({ length: length + 8 }, (_, index) => index % 251);
        const left = leftBacking.subarray(3, 3 + length);
        const rightBacking = new Uint8Array(length + 12);
        rightBacking.set(left, 7);
        const right = rightBacking.subarray(7, 7 + length);
        expect(snapshotValuesEqual(left, right)).toBe(true);
        rightBacking[0] = 99;
        expect(snapshotValuesEqual(left, right)).toBe(true);
        expect(snapshotValuesEqual(left, new Uint8Array(length + 1))).toBe(false);
        for (const index of new Set([0, Math.floor(length / 2), length - 1])) {
            if (index < 0 || index >= length) continue;
            right[index] ^= 255;
            expect(snapshotValuesEqual(left, right)).toBe(false);
            expect(snapshotValuesEqual(right, left)).toBe(false);
            right[index] ^= 255;
        }
        expect(snapshotValuesEqual(left, right)).toBe(true);
    });

    it('keeps binary prototypes distinct even when byte sequences match', () => {
        const bytes = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
        const values = [bytes, Buffer.from(bytes), new Uint16Array(bytes.buffer), new Float64Array(bytes.buffer), new DataView(bytes.buffer), bytes.buffer];
        for (let left = 0; left < values.length; left++) {
            for (let right = 0; right < values.length; right++) {
                expect(snapshotValuesEqual(values[left], values[right])).toBe(left === right);
            }
        }
        expect(snapshotValuesEqual(new DataView(bytes.buffer, 2, 4), new DataView(bytes.slice(2, 6).buffer))).toBe(true);
        expect(snapshotValuesEqual(Buffer.from(bytes).subarray(2, 6), Buffer.from([3, 4, 5, 6]))).toBe(true);
        expect(snapshotValuesEqual(bytes.buffer, bytes.slice().buffer)).toBe(true);
    });

    it('keeps byte-view metadata observation order before comparing data', () => {
        const events: string[] = [];
        const left = Uint8Array.from([1, 2]), right = Uint8Array.from([9, 9]);
        const leftBuffer = left.buffer, rightBuffer = right.buffer;
        for (const [label, value, buffer] of [['left', left, leftBuffer], ['right', right, rightBuffer]] as const) {
            Object.defineProperties(value, {
                buffer: { get: (): ArrayBufferLike => {
                    events.push(`${label}:buffer`);
                    if (label === 'right') right.set([1, 2]);
                    return buffer;
                } },
                byteOffset: { get: (): number => {
                    events.push(`${label}:offset`);return 0;
                } },
                byteLength: { get: (): number => {
                    events.push(`${label}:length`);return 2;
                } },
            });
        }
        expect(snapshotValuesEqual(left, right)).toBe(true);
        expect(events).toEqual(['left:buffer', 'left:offset', 'left:length', 'right:buffer', 'right:offset', 'right:length']);
    });

    it('does not read the second view when the first view metadata throws', () => {
        const left = new Uint8Array(1), right = new Uint8Array(1);
        const observeRight = jest.fn(() => new ArrayBuffer(1));
        Object.defineProperty(left, 'buffer', { get: (): never => {
            throw new Error('left buffer failed');
        } });
        Object.defineProperty(right, 'buffer', { get: observeRight });
        expect(() => snapshotValuesEqual(left, right)).toThrow('left buffer failed');
        expect(observeRight).not.toHaveBeenCalled();
    });

    it('compares shared backing storage through the same visible-byte contract', () => {
        const shared = new SharedArrayBuffer(8);
        const first = new Uint8Array(shared, 2, 4);
        first.set([1, 2, 3, 4]);
        const second = Uint8Array.from([1, 2, 3, 4]);
        expect(snapshotValuesEqual(first, second)).toBe(true);
        first[3] = 9;
        expect(snapshotValuesEqual(first, second)).toBe(false);
    });
});
