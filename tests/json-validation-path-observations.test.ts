import { normalizeJsonValue, serializeJsonValue } from '../packages/core/src/json-value';
import { observedJsonRejection } from './support/observed-json-rejection';

describe('JSON validation path observations', () => {
    it('retains the first deep path while later siblings drain failures', () => {
        const rejected = observedJsonRejection(new Error('late rejection'));
        const input = {
            alpha: [0, { 'bad-key': { leaf: NaN } }],
            beta: { other: [undefined] },
            gamma: rejected.promise,
        };
        expect(() => normalizeJsonValue(input, 'Root.data')).toThrow(
            'Unsupported JSON value at \'Root.data.alpha[1]["bad-key"].leaf\' (NaN).',
        );
        expect(rejected.observed()).toBe(true);
    });

    it('observes every quoted path encoder even after the first error', () => {
        const original = JSON.stringify;
        const calls: unknown[] = [], receivers: unknown[] = [];
        let failure: unknown;
        JSON.stringify = function (this: unknown, value: unknown): string {
            calls.push(value);receivers.push(this);
            return original(`${String(value)}_${String(calls.length)}`);
        };
        try {
            normalizeJsonValue({ 'a-b': NaN, 'c-d': { later: undefined } }, 'Row.data');
        } catch (error) {
            failure = error;
        } finally {
            JSON.stringify = original;
        }
        expect(calls).toEqual(['a-b', 'c-d']);
        expect(receivers).toEqual([JSON, JSON]);
        expect(failure).toBeInstanceOf(TypeError);
        expect((failure as Error).message).toContain('Row.data["a-b_1"]');
    });

    it('keeps reentrant validation paths separate from an active encoder', () => {
        const original = JSON.stringify;
        let inner: unknown, outer: unknown;
        JSON.stringify = function (value: unknown): string {
            if (value === 'a-b') {
                try {
                    normalizeJsonValue({ items: [{ 'c-d': NaN }] }, 'Inner.data');
                } catch (error) {
                    inner = error;
                }
            }
            return original(value);
        };
        try {
            normalizeJsonValue({ 'a-b': { leaf: NaN }, z: [undefined] }, 'Outer.data');
        } catch (error) {
            outer = error;
        } finally {
            JSON.stringify = original;
        }
        expect((inner as Error).message).toContain('Inner.data.items[0]["c-d"]');
        expect((outer as Error).message).toContain('Outer.data["a-b"].leaf');
    });

    it('finishes quoted validation paths before canonical key and scalar emission', () => {
        const original = JSON.stringify;
        const calls: unknown[] = [];
        let result: string | undefined;
        JSON.stringify = function (value: unknown): string {
            calls.push(value);return original(value);
        };
        try {
            result = serializeJsonValue({ 'a-b': { 'c-d': [1, 2] }, tail: 3 }, 'Row.data');
        } finally {
            JSON.stringify = original;
        }
        expect(result).toBe('{"a-b":{"c-d":[1,2]},"tail":3}');
        expect(calls).toEqual(['a-b', 'c-d', 'a-b', 'c-d', 1, 2, 'tail', 3]);
    });
});
