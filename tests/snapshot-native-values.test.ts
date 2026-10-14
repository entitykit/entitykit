import { cloneSnapshotValue } from '../packages/core/src/tracking/snapshot-value-clone';

describe('snapshot native value ownership', () => {
    it('preserves promises for the owning validator to consume', async () => {
        const failure = new Error('unsupported async value');
        const promise = Promise.reject(failure);
        const source = { promise };

        expect(cloneSnapshotValue(promise)).toBe(promise);
        const copy = cloneSnapshotValue(source) as typeof source;
        expect(copy.promise).toBe(promise);
        await expect(copy.promise).rejects.toBe(failure);
    });

    it('copies regular expression state independently', () => {
        const expression = /owned/gi;
        expression.lastIndex = 3;

        const copy = cloneSnapshotValue({ expression }) as { expression: RegExp };

        expect(copy.expression).not.toBe(expression);
        expect(copy.expression.source).toBe('owned');
        expect(copy.expression.flags).toBe('gi');
        expect(copy.expression.lastIndex).toBe(3);
        expression.lastIndex = 0;
        expect(copy.expression.lastIndex).toBe(3);
    });

    it('copies complete buffers and only the visible slice of binary views', () => {
        const buffer = Uint8Array.from([9, 8, 1, 2, 3, 4, 7, 6]).buffer;
        const source = {
            buffer, view: new DataView(buffer, 2, 4), typed: new Uint16Array(buffer, 2, 2),
        };

        const copy = cloneSnapshotValue(source) as typeof source;

        expect(copy.buffer).not.toBe(buffer);
        expect([...new Uint8Array(copy.buffer)]).toEqual([9, 8, 1, 2, 3, 4, 7, 6]);
        expect(copy.view).toBeInstanceOf(DataView);
        expect(copy.typed).toBeInstanceOf(Uint16Array);
        expect([...copy.typed]).toEqual([...source.typed]);
        for (const view of [copy.view, copy.typed]) {
            expect(view.buffer).not.toBe(buffer);
            expect(view.byteOffset).toBe(0);
            expect(view.byteLength).toBe(4);
            expect(view.buffer.byteLength).toBe(4);
            expect([...new Uint8Array(view.buffer)]).toEqual([1, 2, 3, 4]);
        }
        new Uint8Array(buffer).fill(0);
        expect([...new Uint8Array(copy.buffer)]).toEqual([9, 8, 1, 2, 3, 4, 7, 6]);
        expect(copy.view.getUint8(0)).toBe(1);
        expect([...new Uint8Array(copy.typed.buffer)]).toEqual([1, 2, 3, 4]);
    });

    it('does not consult a DataView constructor override', () => {
        const source = new DataView(Uint8Array.from([4, 5, 6]).buffer, 1, 2);
        Object.defineProperty(source, 'constructor', {
            get(): never {
                throw new Error('DataView constructor must not be observed');
            },
        });

        const copy = cloneSnapshotValue(source) as DataView;

        expect(copy).toBeInstanceOf(DataView);
        expect(copy.byteOffset).toBe(0);
        expect(copy.byteLength).toBe(2);
        expect([...new Uint8Array(copy.buffer)]).toEqual([5, 6]);
        expect(copy.buffer).not.toBe(source.buffer);
    });

    it('retains refusal of a callable prototype', () => {
        const source: unknown = Object.create(() => undefined);

        expect(() => cloneSnapshotValue(source)).toThrow(
            new TypeError('Snapshot values must have an object or null prototype.'),
        );
    });
});
