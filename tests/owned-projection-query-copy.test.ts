import { ownFlatProjectionQuery } from '../packages/core/src/query/owned-flat-projection';
import { createQueryModel, type QueryModel } from '../packages/core/src/query/query-model';
import { requireDefined } from './support/require-defined';

class Row {}
function query(): QueryModel<Row> {
    return { ...createQueryModel(Row), projection: [
        { kind: 'field', alias: 'result', propertyName: 'value', sourceAlias: 'root', path: ['result'] },
    ] };
}

describe('projection query copy descriptors', () => {
    it('owns ordinary query data without building bulk descriptor records', () => {
        const model = query(), inspect = jest.spyOn(Object, 'getOwnPropertyDescriptors');
        let owned: ReturnType<typeof ownFlatProjectionQuery>, calls: number;
        try {
            owned = ownFlatProjectionQuery(model);calls = inspect.mock.calls.length;
        } finally {
            inspect.mockRestore();
        }
        expect(calls).toBe(0);
        expect(requireDefined(owned).projection).toEqual(model.projection);
        expect(owned).not.toBe(model);
    });

    it.each([false, true])('preserves all ordinary keys and references, null prototype=%p', bare => {
        const model = query(), symbol = Symbol('query annotation'), annotation = { retained: true };
        Object.defineProperty(model, '__proto__', { value: annotation, enumerable: true, configurable: true, writable: true });
        Object.assign(model, { 7: 'integer key', [symbol]: annotation, optional: undefined });
        if (bare) Object.setPrototypeOf(model, null);
        const owned = requireDefined(ownFlatProjectionQuery(model));
        expect(Object.getPrototypeOf(owned)).toBe(bare ? null : Object.prototype);
        expect(Reflect.ownKeys(owned)).toEqual(Reflect.ownKeys(model));
        for (const key of Reflect.ownKeys(model)) {
            if (key === 'projection') continue;
            const descriptor = requireDefined(Object.getOwnPropertyDescriptor(owned, key));
            expect(descriptor).toEqual(Object.getOwnPropertyDescriptor(model, key));
            expect(descriptor.value).toBe(Reflect.get(model, key));
        }
        expect(Reflect.get(owned, symbol)).toBe(annotation);
        expect(Reflect.get(owned, '__proto__')).toBe(annotation);
        expect(Object.getOwnPropertyDescriptor(owned, 'projection'))
            .toEqual({ value: owned.projection, enumerable: true, writable: false, configurable: false });
        expect(Reflect.set(owned, 'projection', [])).toBe(false);
        expect(Reflect.deleteProperty(owned, 'projection')).toBe(false);
    });

    it.each(['enumerable', 'writable', 'configurable'] as const)(
        'retains a query descriptor with %s=false and still owns projection', flag => {
            const model = query(), annotation = { independent: true };
            Object.defineProperty(model, 'annotation', {
                value: annotation, enumerable: true, writable: true, configurable: true, [flag]: false,
            });
            Object.freeze(requireDefined(model.projection)[0]);
            const owned = requireDefined(ownFlatProjectionQuery(model));
            for (const key of Reflect.ownKeys(model)) {
                if (key === 'projection') continue;
                expect(Object.getOwnPropertyDescriptor(owned, key)).toEqual(Object.getOwnPropertyDescriptor(model, key));
            }
            expect(owned.projection).not.toBe(model.projection);
            expect(Reflect.set(owned, 'projection', [])).toBe(false);
            expect(Object.getOwnPropertyDescriptor(owned, 'projection')?.enumerable).toBe(true);
        },
    );

    it('owns a frozen query with a hidden nonconfigurable projection', () => {
        const model = query(), symbol = Symbol('hidden');
        Object.defineProperty(model, symbol, { value: { retained: true } });
        Object.defineProperty(model, 'projection', { enumerable: false });
        Object.freeze(model);
        const owned = requireDefined(ownFlatProjectionQuery(model));
        expect(Reflect.ownKeys(owned)).toEqual(Reflect.ownKeys(model));
        expect(Object.getOwnPropertyDescriptor(owned, symbol)).toEqual(Object.getOwnPropertyDescriptor(model, symbol));
        expect(Object.getOwnPropertyDescriptor(owned, 'projection'))
            .toEqual({ value: owned.projection, enumerable: true, writable: false, configurable: false });
        expect(owned.projection).not.toBe(model.projection);
        expect(Object.isFrozen(model)).toBe(true);
    });

    it('retains nonstandard field data descriptors without requiring writable source fields', () => {
        const model = query(), item = requireDefined(model.projection)[0];
        Object.defineProperty(item, 'alias', { value: 'result', enumerable: false, writable: false, configurable: false });
        const owned = requireDefined(ownFlatProjectionQuery(model));
        expect(owned.projection[0]).toEqual({ kind: 'field', alias: 'result', propertyName: 'value', sourceAlias: 'root', path: ['result'] });
        expect(Object.isFrozen(owned.projection[0])).toBe(true);
    });

    it('does not call inherited setters while copying an ordinary query', () => {
        const model = query(), setter = jest.fn();
        Object.defineProperty(Object.prototype, 'orderings', { configurable: true, set: setter });
        let owned: ReturnType<typeof ownFlatProjectionQuery>;
        try {
            owned = ownFlatProjectionQuery(model);
        } finally {
            Reflect.deleteProperty(Object.prototype, 'orderings');
        }
        expect(setter).not.toHaveBeenCalled();
        expect(requireDefined(owned).orderings).toBe(model.orderings);
        expect(Object.hasOwn(requireDefined(owned), 'orderings')).toBe(true);
    });

    it.each([Symbol('extra'), 'extra'])('declines a query accessor %p without invoking it', key => {
        const model = query(), get = jest.fn();
        Object.defineProperty(model, key, { get, configurable: true });
        expect(ownFlatProjectionQuery(model)).toBeUndefined();expect(get).not.toHaveBeenCalled();
    });

    it.each(['kind', 'alias', 'propertyName'])('does not read an inherited required field %s', key => {
        const model = query(), item = requireDefined(model.projection)[0];
        const value: unknown = Reflect.get(item, key), get = jest.fn(() => value);
        Reflect.deleteProperty(item, key);
        Object.defineProperty(Object.prototype, key, { get, configurable: true });
        let owned: ReturnType<typeof ownFlatProjectionQuery>;
        try {
            owned = ownFlatProjectionQuery(model);
        } finally {
            Reflect.deleteProperty(Object.prototype, key);
        }
        expect(owned).toBeUndefined();expect(get).not.toHaveBeenCalled();
    });
});
