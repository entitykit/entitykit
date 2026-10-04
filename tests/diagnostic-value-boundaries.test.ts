import { formatDebugValue } from '../packages/core/src/debug-value';
import { sanitizeErrorDetails } from '../packages/core/src/errors/error-detail-sanitizer';

describe('bounded diagnostic values', () => {
    it('formats nullish, symbolic, callable and invalid-date values safely', () => {
        expect(formatDebugValue(null)).toBe('null');
        expect(formatDebugValue(undefined)).toBe('undefined');
        expect(formatDebugValue(Symbol())).toBe('[Symbol ]');
        expect(formatDebugValue((): number => 1)).toBe('[Function anonymous]');
        expect(formatDebugValue(new Date(NaN))).toBe('Date(Invalid)');
        expect(formatDebugValue(new Date(0))).toBe('Date("1970-01-01T00:00:00.000Z")');
    });

    it('limits string and symbol previews while reporting omitted characters', () => {
        expect(formatDebugValue('x'.repeat(161)))
            .toBe(JSON.stringify(`${'x'.repeat(160)}…(+1 chars)`));
        expect(formatDebugValue(Symbol('s'.repeat(81))))
            .toBe(`[Symbol ${'s'.repeat(80)}…(+1 chars)]`);
    });

    it('limits binary previews and preserves the source bytes', () => {
        const bytes = new Uint8Array(33).fill(15);
        expect(formatDebugValue(bytes))
            .toBe(`Uint8Array(length=33, hex=${'0f'.repeat(32)}…)`);
        expect(Array.from(bytes)).toEqual(Array(33).fill(15));
    });

    it('does not execute getters while formatting symbol and accessor properties', () => {
        const getter = jest.fn(() => {
            throw new Error('getter must not execute'); 
        });
        const object = { [Symbol('key')]: 42 };
        Object.defineProperty(object, 'value', { enumerable: true, get: getter });
        expect(formatDebugValue(object)).toContain('[Symbol(key)]: 42');
        expect(formatDebugValue(object)).toContain('"value": [Accessor]');
        expect(getter).not.toHaveBeenCalled();
    });

    it('bounds collections and depth while recognizing cycles and shared acyclic values', () => {
        const cycle: { self?: object } = {};
        cycle.self = cycle;
        expect(formatDebugValue(cycle)).toContain('[Circular]');
        const shared = { value: 42 };
        expect(formatDebugValue({ first: shared, second: shared })).not.toContain('[Circular]');
        expect(formatDebugValue({ a: { b: { c: { d: { value: 42 } } } } }))
            .toContain('"d": [Object]');
        expect(formatDebugValue(Array.from({ length: 21 }, (_, index) => index)))
            .toContain('19, …]');
        expect(formatDebugValue(Object.fromEntries(
            Array.from({ length: 21 }, (_, index) => [`field${String(index)}`, index]),
        ))).toContain('"field19": 19, …}');
    });

    it('returns a fallback when a proxy prevents descriptor inspection', () => {
        const proxy = new Proxy({}, { ownKeys: () => {
            throw new Error('inspection refused'); 
        } });
        expect(formatDebugValue(proxy)).toBe('[Unformattable]');
        expect(sanitizeErrorDetails({ available: 42, failed: proxy }))
            .toEqual({ available: 42, failed: '[Unserializable]' });
        expect(sanitizeErrorDetails(proxy)).toEqual({ unavailable: '[Unserializable]' });
    });

    it('renders error names without retaining messages, stacks or causes', () => {
        const error = new TypeError('private driver text', { cause: 'private cause' });
        const details = sanitizeErrorDetails({ error, invalidDate: new Date(NaN), date: new Date(0) });
        expect(details).toEqual({
            error: { name: 'TypeError' }, invalidDate: '[Invalid Date]', date: '1970-01-01T00:00:00.000Z',
        });
        expect(JSON.stringify(details)).not.toContain('private');
    });

    it('captures sparse arrays and accessor slots without invoking callbacks', () => {
        const getter = jest.fn(() => {
            throw new Error('getter must not execute'); 
        });
        const array = Array(3) as unknown[];
        Object.defineProperty(array, '1', { get: getter, enumerable: true });
        array[2] = 42;
        const object = { visible: array };
        Object.defineProperty(object, 'accessor', { get: getter, enumerable: true });
        Object.defineProperty(object, 'hidden', { value: 'hidden', enumerable: false });
        expect(sanitizeErrorDetails(object))
            .toEqual({ visible: [null, '[Accessor]', 42], accessor: '[Accessor]' });
        expect(getter).not.toHaveBeenCalled();
    });

    it('limits detail strings, binary values and collection sizes', () => {
        const details = sanitizeErrorDetails({
            text: 'x'.repeat(501), binary: new Uint8Array(33),
            array: Array.from({ length: 101 }, (_, index) => index),
            object: Object.fromEntries(Array.from({ length: 101 }, (_, index) => [`field${String(index)}`, index])),
            bigint: 42n, symbol: Symbol('value'), callback: (): number => 1,
        });
        expect(details.text).toBe(`${'x'.repeat(500)}…`);
        expect(details.binary).toBe('[Uint8Array length=33]');
        expect(details.array).toHaveLength(100);
        expect(Object.keys(details.object as object)).toHaveLength(100);
        expect(details).toMatchObject({ bigint: '42n', symbol: '[symbol]', callback: '[function]' });
        expect(() => JSON.stringify(details)).not.toThrow();
    });

    it('bounds detail nesting and preserves repeated acyclic references', () => {
        const cycle: { self?: object } = {};
        cycle.self = cycle;
        const shared = { value: 42 };
        expect(sanitizeErrorDetails({ cycle, first: shared, second: shared })).toEqual({
            cycle: { self: '[Circular]' }, first: { value: 42 }, second: { value: 42 },
        });
        expect(sanitizeErrorDetails({ a: { b: { c: { d: { value: 42 } } } } }))
            .toEqual({ a: { b: { c: { d: '[Maximum depth]' } } } });
    });
});
