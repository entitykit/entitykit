import { normalizeJsonValue, serializeJsonValue } from '../packages/core/src/json-value';

describe('repeated JSON values across nested paths', () => {
    it.each([0, 1, 2, 3, 7])('retains a completed alias beneath %i parents', depth => {
        const shared = { value: 7 };
        let branch: object = shared;
        for (let index = 0; index < depth; index++) branch = { child: branch };
        const source = { a: branch, z: shared };
        const result = normalizeJsonValue(source) as Record<string, unknown>;
        let nested = result.a as Record<string, unknown>;
        for (let index = 0; index < depth; index++) nested = nested.child as Record<string, unknown>;
        expect(nested).toBe(result.z);
        expect(nested).not.toBe(shared);
        expect(nested).toEqual({ value: 7 });
        nested.value = 99;
        expect(shared.value).toBe(7);
    });

    it.each([0, 1, 2])('drains a repeated unsupported value beneath %i parents', depth => {
        let consumed = 0;
        class Unsupported {
            public then(): void {
                consumed++;
            }
        }
        const shared = new Unsupported();
        let branch: object = shared;
        for (let index = 0; index < depth; index++) branch = { child: branch };
        expect(() => normalizeJsonValue({ a: branch, z: shared }, 'Row.data'))
            .toThrow(`Unsupported JSON value at 'Row.data.a${'.child'.repeat(depth)}' (Promise or thenable).`);
        expect(consumed).toBe(2);
    });

    it.each([normalizeJsonValue, serializeJsonValue])('includes the default diagnostic path', normalize => {
        expect(() => normalize({ bad: NaN }))
            .toThrow('Unsupported JSON value at \'JSON value.bad\' (NaN).');
    });
});
