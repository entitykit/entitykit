import { ownFlatProjectionQuery } from '../packages/core/src/query/owned-flat-projection';
import { createQueryModel, type QueryModel } from '../packages/core/src/query/query-model';
import type { ProjectionFieldExpression } from '../packages/core/src/query/projection-expression-types';
import { requireDefined } from './support/require-defined';

class Row {}
function field(): ProjectionFieldExpression {
    return { kind: 'field', alias: 'result', propertyName: 'value', path: ['result'], sourceAlias: 'root' };
}
function query(projection: unknown = [field()]): QueryModel<Row> {
    return { ...createQueryModel(Row), projection: projection as QueryModel<Row>['projection'] };
}

describe('owned flat projection shape', () => {
    it('captures private frozen fields and paths without freezing caller state', () => {
        const item = field(), source = [item], model = query(source);
        const owned = requireDefined(ownFlatProjectionQuery(model));
        expect(owned).not.toBe(model);expect(owned.projection).not.toBe(source);
        expect(owned.projection[0]).not.toBe(item);expect(owned.projection[0].path).not.toBe(item.path);
        expect(Object.isFrozen(owned.projection)).toBe(true);
        expect(Object.isFrozen(owned.projection[0])).toBe(true);
        expect(Object.isFrozen(owned.projection[0].path)).toBe(true);
        expect(Object.isFrozen(model)).toBe(false);expect(Object.isFrozen(item)).toBe(false);
        Reflect.set(item, 'alias', 'changed');Reflect.set(requireDefined(item.path), 0, 'changed');source.push(field());
        expect(owned.projection).toEqual([field()]);
        expect(Object.getOwnPropertyDescriptor(owned, 'projection')?.enumerable).toBe(true);
        expect(Reflect.set(owned, 'projection', [])).toBe(false);
        expect(() => Object.defineProperty(owned, 'projection', { value: [] })).toThrow(TypeError);
        expect(owned.orderings).toBe(model.orderings);
        expect(Reflect.set(model, 'projection', [])).toBe(true);
    });

    it('retains null prototypes and explicitly owns absent optional fields', () => {
        const item = Object.assign(Object.create(null) as object, { kind: 'field', alias: 'x', propertyName: 'value' });
        const model = query([item]);Object.setPrototypeOf(model, null);
        const owned = requireDefined(ownFlatProjectionQuery(model));
        expect(Object.getPrototypeOf(owned)).toBeNull();
        expect(owned.projection[0]).toEqual({ kind: 'field', alias: 'x', propertyName: 'value', path: undefined, sourceAlias: undefined });
        expect(Object.hasOwn(owned.projection[0], 'path')).toBe(true);
        expect(Object.hasOwn(owned.projection[0], 'sourceAlias')).toBe(true);
    });

    it.each([
        ['absent', undefined], ['empty', []], ['sparse', new Array<unknown>(1)],
        ['non-array', {}], ['null', null], ['primitive', 1],
        ['custom array prototype', Object.setPrototypeOf([field()], null) as unknown],
        ['extra array property', Object.assign([field()], { extra: true })],
    ])('declines %s projections', (_name, projection) => {
        const model = query();Reflect.set(model, 'projection', projection);
        expect(ownFlatProjectionQuery(model)).toBeUndefined();
    });

    it.each([
        { kind: 'literal', alias: 'result', value: 1 },
        { ...field(), kind: 'computed' }, { ...field(), alias: 1, path: undefined },
        { ...field(), propertyName: undefined }, { ...field(), sourceAlias: 'joined' },
        { ...field(), sourceAlias: null }, { ...field(), path: null },
        { ...field(), path: [] }, { ...field(), path: ['result', 'nested'] },
        { ...field(), path: ['other'] }, { ...field(), path: new Array<string>(1) },
        { ...field(), extra: 1 }, { ...field(), [Symbol('extra')]: 1 },
        Object.assign(Object.create({ inherited: true }) as object, field()),
        null, undefined, 42,
    ])('declines unsupported field shape %p', item => {
        expect(ownFlatProjectionQuery(query([item]))).toBeUndefined();
    });

    it.each(['query', 'field', 'array', 'path', 'joins'] as const)(
        'does not invoke getters while declining an accessor-backed %s', location => {
            const item = field(), model = query([item]), get = jest.fn(() => 'result');
            if (location === 'query') Object.defineProperty(model, 'projection', { get });
            if (location === 'field') Object.defineProperty(item, 'alias', { get });
            if (location === 'array') Object.defineProperty(model.projection, 0, { get });
            if (location === 'path') Object.defineProperty(item.path, 0, { get });
            if (location === 'joins') Object.defineProperty(model, 'joins', { get });
            expect(ownFlatProjectionQuery(model)).toBeUndefined();expect(get).not.toHaveBeenCalled();
        },
    );

    it.each(['query', 'field', 'array', 'path', 'joins'] as const)(
        'declines a proxy %s without running traps', location => {
            const item = field(), model = query([item]);
            const trap = jest.fn(() => {
                throw new Error('must not inspect proxy');
            });
            const proxy = (value: object): object => new Proxy(value, { get: trap, getPrototypeOf: trap, ownKeys: trap, getOwnPropertyDescriptor: trap });
            let input = model;
            if (location === 'query') input = proxy(model) as QueryModel<Row>;
            if (location === 'field') Reflect.set(requireDefined(model.projection), 0, proxy(item));
            if (location === 'array') Reflect.set(model, 'projection', proxy(requireDefined(model.projection)));
            if (location === 'path') Reflect.set(item, 'path', proxy(requireDefined(item.path)));
            if (location === 'joins') Reflect.set(model, 'joins', proxy([]));
            expect(ownFlatProjectionQuery(input)).toBeUndefined();expect(trap).not.toHaveBeenCalled();
        },
    );

    it('declines revoked array proxies and custom iterators without invoking them', () => {
        const revoked = Proxy.revocable([], {});revoked.revoke();
        expect(ownFlatProjectionQuery(query(revoked.proxy))).toBeUndefined();
        const projection = [field()], iterator = jest.fn();
        Object.defineProperty(projection, Symbol.iterator, { value: iterator });
        expect(ownFlatProjectionQuery(query(projection))).toBeUndefined();expect(iterator).not.toHaveBeenCalled();
    });

    it.each(['path', 'sourceAlias'])('declines inherited optional %s without reading it', key => {
        const item = { kind: 'field', alias: 'result', propertyName: 'value' }, get = jest.fn();
        Object.defineProperty(Object.prototype, key, { configurable: true, get });
        try {
            expect(ownFlatProjectionQuery(query([item]))).toBeUndefined();
            expect(get).not.toHaveBeenCalled();
        } finally {
            Reflect.deleteProperty(Object.prototype, key);
        }
    });

    it('declines queries with joins, missing required shape, or custom prototypes', () => {
        const joined = query();Reflect.set(joined, 'joins', [{}]);
        expect(ownFlatProjectionQuery(joined)).toBeUndefined();
        for (const key of ['entityType', 'projection', 'joins']) {
            const model = query();Reflect.deleteProperty(model, key);
            expect(ownFlatProjectionQuery(model)).toBeUndefined();
        }
        expect(ownFlatProjectionQuery(Object.setPrototypeOf(query(), { custom: true }) as QueryModel<Row>)).toBeUndefined();
    });
    it.each(['kind', 'alias', 'propertyName'])('declines an actually missing required %s', key => {
        const item = field();Reflect.deleteProperty(item, key);
        expect(ownFlatProjectionQuery(query([item]))).toBeUndefined();
    });

    it('accepts legacy flat fields with absent optional properties', () => {
        const item = { kind: 'field', alias: 'result', propertyName: 'value' };
        expect(requireDefined(ownFlatProjectionQuery(query([item]))).projection[0])
            .toEqual({ ...item, path: undefined, sourceAlias: undefined });
    });

    it.each(['path', 'sourceAlias'])('keeps own and null-prototype %s independent of inherited accessors', key => {
        const get = jest.fn();
        const bare = Object.assign(Object.create(null) as object, { kind: 'field', alias: 'result', propertyName: 'value' });
        Object.defineProperty(Object.prototype, key, { configurable: true, get });
        try {
            expect(ownFlatProjectionQuery(query([bare]))).toBeDefined();
            expect(ownFlatProjectionQuery(query([field()]))).toBeDefined();
            expect(get).not.toHaveBeenCalled();
        } finally {
            Reflect.deleteProperty(Object.prototype, key);
        }
    });

    it.each(['path', 'sourceAlias', 'offset'])('declines optional accessor %s without losing live semantics', key => {
        const item = field(), model = query([item]), get = jest.fn();
        Object.defineProperty(key === 'offset' ? model : item, key, { configurable: true, get });
        expect(ownFlatProjectionQuery(model)).toBeUndefined();expect(get).not.toHaveBeenCalled();
    });

});
