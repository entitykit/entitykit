import { normalizeJsonValue, serializeJsonValue } from '../packages/core/src/json-value';
import { inspectJsonObject } from '../packages/core/src/json/json-object-inspection';
import { createJsonNormalizationState } from '../packages/core/src/json/json-normalization-state';
import { observedJsonRejection } from './support/observed-json-rejection';

describe('JSON descriptor snapshot observations', () => {
    it.each([
        { then: true }, { then: 1 }, { then: 'label' }, { then: { value: 1 } }, { then: [1] },
    ])('accepts non-callable own then value %p', ({ then }) => {
        const source = { then, value: 2 };
        expect(normalizeJsonValue(source)).toEqual(source);
        expect(serializeJsonValue(source)).toBe(JSON.stringify(source));
    });

    it('does not inspect inherited array entries past the captured key list', () => {
        const original = Object.getOwnPropertyDescriptor(Array.prototype, '1');
        const state = createJsonNormalizationState();
        let reads = 0, inspected: ReturnType<typeof inspectJsonObject>;
        try {
            Object.defineProperty(Array.prototype, '1', {
                configurable: true,
                get: (): never => {
                    reads++;
                    throw new Error('Inspection read past its own keys.');
                },
            });
            inspected = inspectJsonObject({ value: 1 }, 'Document.data', state);
        } finally {
            if (original) Object.defineProperty(Array.prototype, '1', original);
            else Reflect.deleteProperty(Array.prototype, '1');
        }
        expect(reads).toBe(0);
        expect(state.firstError).toBeUndefined();
        expect(inspected?.descriptors.value).toEqual({
            value: 1, enumerable: true, configurable: true, writable: true,
        });
    });

    it.each(['object', 'array', 'null prototype'])('does not invoke array iterators while inspecting %s', kind => {
        const value: object = kind === 'array' ? [1, 2] : kind === 'null prototype'
            ? Object.assign(Object.create(null) as object, { value: 1 }) : { value: 1 };
        const state = createJsonNormalizationState();
        const original = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);
        if (!original) throw new Error('Missing array iterator descriptor.');
        let iteratorCalls = 0, inspected: ReturnType<typeof inspectJsonObject>;
        try {
            Object.defineProperty(Array.prototype, Symbol.iterator, {
                ...original,
                value: (): never => {
                    iteratorCalls++;
                    throw new Error('Descriptor collection invoked an array iterator.');
                },
            });
            inspected = inspectJsonObject(value, 'Document.data', state);
        } finally {
            Object.defineProperty(Array.prototype, Symbol.iterator, original);
        }
        expect(iteratorCalls).toBe(0);
        expect(state.firstError).toBeUndefined();
        expect(inspected?.prototype).toBe(Object.getPrototypeOf(value));
        expect(Object.entries(inspected?.descriptors ?? {}))
            .toEqual(Object.entries(Object.getOwnPropertyDescriptors(value)));
    });

    it.each(['normalize', 'serialize'])('snapshots all parent fields before %s inspects a child', method => {
        let lateReads = 0;
        const source: Record<string, unknown> = { b: 2, z: 3 };
        source.a = new Proxy({ value: 1 }, {
            getPrototypeOf(target): object | null {
                source.z = 9;
                source.added = 4;
                Object.defineProperty(source, 'b', {
                    configurable: true, enumerable: true,
                    get: (): number => {
                        lateReads++;
                        return 8;
                    },
                });
                return Reflect.getPrototypeOf(target);
            },
            get(): never {
                throw new Error('Inspection read a source property.');
            },
        });
        const result = method === 'normalize' ? normalizeJsonValue(source) : serializeJsonValue(source);
        expect(result).toEqual(method === 'normalize' ? { a: { value: 1 }, b: 2, z: 3 }
            : '{"a":{"value":1},"b":2,"z":3}');
        expect(lateReads).toBe(0);
        expect(source.z).toBe(9);
        expect(Object.hasOwn(source, 'added')).toBe(true);
    });

    it('finishes proxy descriptors in reported order and omits a disappearing key before recursion', () => {
        const events: string[] = [];
        const child = new Proxy({ value: 1 }, {
            getPrototypeOf(target): object | null {
                events.push('child:prototype');
                return Reflect.getPrototypeOf(target);
            },
        });
        const source = new Proxy({ a: child, z: 2, gone: 3 }, {
            getPrototypeOf(target): object | null {
                events.push('root:prototype');
                return Reflect.getPrototypeOf(target);
            },
            ownKeys(): string[] {
                events.push('root:keys');
                return ['z', 'a', 'gone'];
            },
            getOwnPropertyDescriptor(target, key): PropertyDescriptor | undefined {
                events.push(`root:${String(key)}`);
                if (key === 'gone') Reflect.deleteProperty(target, key);
                return Reflect.getOwnPropertyDescriptor(target, key);
            },
            get(): never {
                throw new Error('Inspection read a source property.');
            },
        });
        expect(serializeJsonValue(source)).toBe('{"a":{"value":1},"z":2}');
        expect(events).toEqual([
            'root:prototype', 'root:keys', 'root:z', 'root:a', 'root:gone', 'child:prototype',
        ]);
    });

    it('keeps descriptor failure ownership while draining later inspected rejections', () => {
        const rejected = observedJsonRejection(new Error('later rejection'));
        const events: string[] = [];
        const bad = new Proxy({ value: 1 }, {
            ownKeys(target): Array<string | symbol> {
                events.push('keys');
                return Reflect.ownKeys(target);
            },
            getOwnPropertyDescriptor(): never {
                events.push('descriptor');
                throw new Error('descriptor rejected');
            },
        });
        expect(() => serializeJsonValue({ z: rejected.promise, a: bad }, 'Document.data'))
            .toThrow('Unsupported JSON value at \'Document.data.a\' (property inspection failed)');
        expect(events).toEqual(['keys', 'descriptor']);
        expect(rejected.observed()).toBe(true);
    });

    it.each(['object', 'array'])('ignores a hidden own then accessor on an ordinary %s', kind => {
        let reads = 0;
        const source = Object.defineProperty(kind === 'object' ? { value: 1 } : [1], 'then', {
            get: (): never => {
                reads++;
                throw new Error('Hidden then read.');
            },
        });
        expect(serializeJsonValue(source)).toBe(kind === 'object' ? '{"value":1}' : '[1]');
        expect(reads).toBe(0);
    });
});
