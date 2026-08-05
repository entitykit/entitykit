import { normalizeJsonValue, serializeJsonValue } from '../src/json-value';

describe('JSON value contract', () => {
    it('snapshots every exact JSON shape', () => {
        const source = Object.assign(Object.create(null) as Record<string, unknown>, {
            string: 'value',
            number: 42,
            boolean: true,
            nil: null,
            nested: [{ ok: false }],
        });

        const normalized = normalizeJsonValue(source, 'Document.data');

        expect(normalized).toEqual({
            string: 'value',
            number: 42,
            boolean: true,
            nil: null,
            nested: [{ ok: false }],
        });
        expect(normalized).not.toBe(source);
        expect(serializeJsonValue(source, 'Document.data')).toBe(
            '{"string":"value","number":42,"boolean":true,"nil":null,"nested":[{"ok":false}]}',
        );
    });

    it.each([
        ['Map', new Map([['key', 'value']])],
        ['Set', new Set([1])],
        ['RegExp', /value/],
        ['Uint8Array', new Uint8Array([1])],
        ['NaN', Number.NaN],
        ['Infinity', Number.POSITIVE_INFINITY],
        ['undefined', { nested: undefined }],
        ['function', { nested: (): void => undefined }],
        ['symbol', { nested: Symbol('value') }],
        ['bigint', { nested: 1n }],
    ])('rejects %s without lossy coercion', (_label, value) => {
        expect(() => normalizeJsonValue(value, 'Document.data')).toThrow(
            'Unsupported JSON value at \'Document.data',
        );
    });

    it('rejects symbol keys, sparse arrays, class instances, and cycles', () => {
        const symbolKey = { ok: true, [Symbol('hidden')]: false };
        const sparse: unknown[] = [];
        sparse.length = 2;
        sparse[1] = 'present';
        class CustomValue {}
        const cyclic: { self?: unknown } = {};
        cyclic.self = cyclic;

        expect(() => normalizeJsonValue(symbolKey, 'Document.data')).toThrow('symbol-keyed property');
        expect(() => normalizeJsonValue(sparse, 'Document.data')).toThrow('\'Document.data[0]\' (missing array element)');
        expect(() => normalizeJsonValue(new CustomValue(), 'Document.data')).toThrow('(CustomValue)');
        expect(() => normalizeJsonValue(cyclic, 'Document.data')).toThrow('\'Document.data.self\' (cyclic reference)');
    });

    it('rejects nested promises with their full path and consumes rejections', async () => {
        const unhandled: unknown[] = [];
        const observeUnhandled = (reason: unknown): void => {
            unhandled.push(reason);
        };
        process.on('unhandledRejection', observeUnhandled);
        try {
            const value = { user: { profile: Promise.reject(new Error('failed')) } };
            expect(() => normalizeJsonValue(value, 'Document.data')).toThrow(
                'Unsupported JSON value at \'Document.data.user.profile\' (Promise or thenable)',
            );
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(unhandled).toEqual([]);
        } finally {
            process.off('unhandledRejection', observeUnhandled);
        }
    });

    it('rejects custom thenables by shape', () => {
        const thenable = { then: (): void => undefined };
        expect(() => normalizeJsonValue([thenable], 'Document.data')).toThrow(
            'Unsupported JSON value at \'Document.data[0]\' (Promise or thenable)',
        );
    });

    it('consumes rejected Promises beyond the first invalid path', async () => {
        const unhandled: unknown[] = [];
        const observeUnhandled = (reason: unknown): void => {
            unhandled.push(reason);
        };
        process.on('unhandledRejection', observeUnhandled);
        try {
            const value = {
                first: Promise.reject(new Error('first failed')),
                second: { nested: Promise.reject(new Error('second failed')) },
            };
            expect(() => normalizeJsonValue(value, 'Document.data')).toThrow(
                'Document.data.first',
            );
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(unhandled).toEqual([]);
        } finally {
            process.off('unhandledRejection', observeUnhandled);
        }
    });
});
