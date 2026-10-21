import { cloneSnapshotValue } from '../packages/core/src/tracking/snapshot-value-clone';

function copiedWithDefinitionCount(value: unknown): { copy: unknown; definitions: number } {
    const define = jest.spyOn(Object, 'defineProperty');
    try {
        const copy = cloneSnapshotValue(value);
        return { copy, definitions: define.mock.calls.length };
    } finally {
        define.mockRestore();
    }
}

describe('snapshot property-definition work', () => {
    it.each([null, Object.prototype as object])('avoids repeated definitions for owned clones with prototype %p', prototype => {
        const rows = Array.from({ length: 100 }, (_, id) => Object.assign(
            Object.create(prototype) as Record<string, unknown>,
            { id, nested: { value: id }, list: [{ label: 'row' }], when: new Date(id), bytes: new Uint8Array([1, 2, 3]) },
        ));

        const result = copiedWithDefinitionCount(rows);
        const copies = result.copy as typeof rows;

        expect(result.definitions).toBe(0);
        expect(copies).toEqual(rows);
        for (let index = 0; index < rows.length; index++) {
            expect(copies[index]).not.toBe(rows[index]);
            expect(Object.getPrototypeOf(copies[index])).toBe(prototype);
            for (const key of ['nested', 'list', 'when', 'bytes']) {
                expect(copies[index]?.[key]).not.toBe(rows[index]?.[key]);
            }
        }
    });

    it('keeps definitions for custom prototypes while copying ordinary nested objects', () => {
        const prototype = { marker: 'custom' };
        const rows = Array.from({ length: 100 }, (_, id) => Object.assign(
            Object.create(prototype) as Record<string, unknown>,
            { id, nested: { value: id }, list: [{ label: 'row' }], when: new Date(id), bytes: new Uint8Array([1, 2, 3]) },
        ));

        const result = copiedWithDefinitionCount(rows);

        expect(result.definitions).toBe(500);
        expect(result.copy).toEqual(rows);
        for (const copy of result.copy as typeof rows) expect(Object.getPrototypeOf(copy)).toBe(prototype);
    });

    it('retains safe definitions for prototype-sensitive keys', () => {
        const source: Record<string, unknown> = { ordinary: { value: 1 } };
        for (const key of ['__proto__', 'constructor']) {
            Object.defineProperty(source, key, { enumerable: true, value: { key } });
        }

        const result = copiedWithDefinitionCount(source);
        const copy = result.copy as typeof source;

        expect(result.definitions).toBe(2);
        expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
        expect(copy.__proto__).toEqual({ key: '__proto__' });
        expect(copy.constructor).toEqual({ key: 'constructor' });
        expect(copy.__proto__).not.toBe(source.__proto__);
        expect(copy.constructor).not.toBe(source.constructor);
    });
});
