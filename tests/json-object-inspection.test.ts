import { normalizeJsonValue } from '../packages/core/src/json-value';
import { observedJsonRejection } from './support/observed-json-rejection';

describe('JSON diagnostics and rejection ownership', () => {
    it('rejects an unreadable prototype diagnostic and still drains inspected promises', () => {
        const rejected = observedJsonRejection(new Error('book metadata failed'));
        const prototype = new Proxy({}, {
            getOwnPropertyDescriptor(): never {
                throw new Error('prototype diagnostic failed');
            },
        });
        const value: unknown = Object.assign(Object.create(prototype) as object, { nested: rejected.promise });
        expect(() => normalizeJsonValue(value, 'Book.metadata')).toThrow(
            'Unsupported JSON value at \'Book.metadata\' (object)',
        );
        expect(rejected.observed()).toBe(true);
    });

    it('does not invoke a constructor name accessor while rejecting its instance', () => {
        const getter = jest.fn((): never => {
            throw new Error('name accessor ran');
        });
        const constructor = function BookValue(): undefined {
            return undefined;
        };
        Object.defineProperty(constructor, 'name', { get: getter });
        const rejected = observedJsonRejection(new Error('book metadata failed'));
        const value: unknown = Object.assign(Object.create({ constructor }) as object, { nested: rejected.promise });
        expect(() => normalizeJsonValue(value, 'Book.metadata')).toThrow(
            'Unsupported JSON value at \'Book.metadata\' (object)',
        );
        expect(getter).not.toHaveBeenCalled();
        expect(rejected.observed()).toBe(true);
    });

    it.each([
        { label: 'undefined', name: undefined }, { label: 'null', name: null },
        { label: 'false', name: false }, { label: 'true', name: true },
        { label: 'number', name: 42 }, { label: 'empty', name: '' },
        { label: 'uncoercible object', name: { toString: (): never => {
            throw new Error('name coerced');
        } } },
    ])('uses a stable fallback for constructor name $label', ({ name }) => {
        const constructor = function BookValue(): undefined {
            return undefined;
        };
        Object.defineProperty(constructor, 'name', { value: name });
        const rejected = observedJsonRejection(new Error('book metadata failed'));
        const value: unknown = Object.assign(Object.create({ constructor }) as object, { nested: rejected.promise });
        expect(() => normalizeJsonValue(value, 'Book.metadata')).toThrow(
            'Unsupported JSON value at \'Book.metadata\' (object)',
        );
        expect(rejected.observed()).toBe(true);
    });

    it('rejects an unreadable constructor name descriptor without escaping cleanup', () => {
        const constructor = new Proxy(function BookValue(): undefined {
            return undefined;
        }, {
            getOwnPropertyDescriptor(): never {
                throw new Error('constructor descriptor failed');
            },
        });
        const rejected = observedJsonRejection(new Error('book metadata failed'));
        const value: unknown = Object.assign(Object.create({ constructor }) as object, { nested: rejected.promise });
        expect(() => normalizeJsonValue(value, 'Book.metadata')).toThrow(
            'Unsupported JSON value at \'Book.metadata\' (object)',
        );
        expect(rejected.observed()).toBe(true);
    });

    it('keeps ordinary class names as diagnostic data', () => {
        class BookValue {}
        expect(() => normalizeJsonValue(new BookValue(), 'Book.metadata'))
            .toThrow('Unsupported JSON value at \'Book.metadata\' (BookValue)');
    });

    it('does not invoke a prototype constructor accessor', () => {
        const getter = jest.fn((): never => {
            throw new Error('constructor accessor ran');
        });
        const prototype = Object.defineProperty({}, 'constructor', { get: getter });
        const rejected = observedJsonRejection(new Error('book metadata failed'));
        const value: unknown = Object.assign(Object.create(prototype) as object, { nested: rejected.promise });
        expect(() => normalizeJsonValue(value, 'Book.metadata')).toThrow('(object)');
        expect(getter).not.toHaveBeenCalled();
        expect(rejected.observed()).toBe(true);
    });

    it.each(['object', 'function'])('refuses unreadable %s descriptors with a stable diagnostic', kind => {
        const value = new Proxy(kind === 'object' ? {} : (): undefined => undefined, {
            ownKeys(): never {
                throw new Error('descriptor inspection failed');
            },
        });
        expect(() => normalizeJsonValue(value, 'Book.metadata')).toThrow(
            'Unsupported JSON value at \'Book.metadata\' (property inspection failed)',
        );
    });

    it('refuses a prototype-inspection failure before reading own values', () => {
        const ownKeys = jest.fn(() => []);
        const value = new Proxy({}, {
            getPrototypeOf(): never {
                throw new Error('prototype inspection failed');
            },
            ownKeys,
        });
        expect(() => normalizeJsonValue(value, 'Book.metadata')).toThrow('(property inspection failed)');
        expect(ownKeys).not.toHaveBeenCalled();
    });

    it('rejects and consumes an inherited thenable with the original receiver', () => {
        const then = jest.fn(() => undefined);
        const value: object = Object.create({ then }) as object;
        expect(() => normalizeJsonValue(value, 'Book.metadata')).toThrow(
            'Unsupported JSON value at \'Book.metadata\' (Promise or thenable)',
        );
        expect(then).toHaveBeenCalledTimes(1);
        expect(then.mock.contexts).toEqual([value]);
        expect(then.mock.calls[0]).toEqual([expect.any(Function), expect.any(Function)]);
    });

    it('rejects a callable inherited thenable and ordinary functions with exact diagnostics', () => {
        const then = jest.fn(() => undefined);
        const value: unknown = Object.setPrototypeOf(() => undefined, { then });
        expect(() => normalizeJsonValue(value, 'Book.metadata')).toThrow(
            'Unsupported JSON value at \'Book.metadata\' (Promise or thenable)',
        );
        expect(then).toHaveBeenCalledTimes(1);
        expect(() => normalizeJsonValue(() => undefined, 'Book.metadata')).toThrow(
            'Unsupported JSON value at \'Book.metadata\' (function)',
        );
    });

    it('does not read an own then accessor while refusing its foreign prototype', () => {
        const getter = jest.fn((): never => {
            throw new Error('own then accessor ran');
        });
        const value = Object.defineProperty(Object.create({}) as object, 'then', { get: getter, enumerable: true });
        expect(() => normalizeJsonValue(value, 'Book.metadata')).toThrow('(object)');
        expect(getter).not.toHaveBeenCalled();
    });

    it('keeps refusal and promise ownership when an inherited then getter throws', () => {
        const getter = jest.fn((): never => {
            throw new Error('inherited then getter ran');
        });
        const prototype = Object.defineProperty({}, 'then', { get: getter });
        const rejected = observedJsonRejection(new Error('book metadata failed'));
        const value: unknown = Object.assign(Object.create(prototype) as object, { nested: rejected.promise });
        expect(() => normalizeJsonValue(value, 'Book.metadata')).toThrow('(object)');
        expect(getter).toHaveBeenCalledTimes(1);
        expect(rejected.observed()).toBe(true);
    });

    it('does not assimilate a thenable that returns itself a second time', async () => {
        const value = { then: jest.fn((): unknown => value) };
        expect(() => normalizeJsonValue(value, 'Book.metadata')).toThrow('(Promise or thenable)');
        await new Promise<void>(resolve => setImmediate(resolve));
        expect(value.then).toHaveBeenCalledTimes(1);
    });

    it('rejects a throwing thenable once and drains its inspected nested rejection', () => {
        const rejected = observedJsonRejection(new Error('nested metadata failed'));
        const then = jest.fn((): never => {
            throw new Error('broken then implementation');
        });
        expect(() => normalizeJsonValue({ then, nested: rejected.promise }, 'Book.metadata'))
            .toThrow('Unsupported JSON value at \'Book.metadata\' (Promise or thenable)');
        expect(then).toHaveBeenCalledTimes(1);
        expect(rejected.observed()).toBe(true);
    });

    it('does not accept a class label from a non-callable constructor', () => {
        const value: unknown = Object.create({ constructor: { name: 'PretendClass' } });
        expect(() => normalizeJsonValue(value, 'Book.metadata'))
            .toThrow('Unsupported JSON value at \'Book.metadata\' (object)');
    });
});
