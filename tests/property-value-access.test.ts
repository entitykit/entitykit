import {
    hasPropertyPath,
    propertyValueTarget,
    readPropertyPath,
    writePropertyPath,
} from '../packages/core/src/model/property-value-access';

describe('mapped property paths', () => {
    it('resolves a direct target without creating ancestors', () => {
        const entity = { value: 1 };
        const target = propertyValueTarget(entity, ['value']);
        expect(target.target).toBe(entity);
        expect(target.propertyName).toBe('value');
        writePropertyPath(entity, ['value'], undefined);
        expect(Object.hasOwn(entity, 'value')).toBe(true);
        expect(entity.value).toBeUndefined();
    });

    it('keeps the entity as the receiver of inherited setters', () => {
        const receivers: object[] = [];
        const prototype = {
            set value(value: number) {
                receivers.push(this);
                Object.defineProperty(this, 'stored', { value });
            },
        };
        const entity = Object.create(prototype) as object;
        writePropertyPath(entity, ['value'], 42);
        expect(receivers).toEqual([entity]);
        expect(Reflect.get(entity, 'stored')).toBe(42);
        expect(Object.hasOwn(prototype, 'stored')).toBe(false);
    });

    it('honors proxy refusals and non-writable direct properties', () => {
        const entity = new Proxy({}, { set: () => false });
        expect(() => {
            writePropertyPath(entity, ['value'], 1); 
        })
            .toThrow('Cannot write mapped property \'value\'.');
        expect(() => {
            writePropertyPath(Object.freeze({ value: 1 }), ['value'], 2); 
        })
            .toThrow(TypeError);
    });

    it('defines an own data property for the prototype key', () => {
        const entity = {};
        const value = { marker: true };
        writePropertyPath(entity, ['__proto__'], value);
        expect(Object.getPrototypeOf(entity)).toBe(Object.prototype);
        expect(Object.getOwnPropertyDescriptor(entity, '__proto__')).toEqual({
            value, writable: true, configurable: true, enumerable: true,
        });
    });

    it.each([
        { path: [] }, { path: [''] }, { path: ['parent', ''] },
    ])('rejects an empty final segment: $path', ({ path }) => {
        expect(() => propertyValueTarget({}, path))
            .toThrow('Mapped property paths must contain at least one segment.');
    });

    it.each([null, undefined])('creates a missing nested object: %s', missing => {
        const entity = { scope: missing };
        writePropertyPath(entity, ['scope', 'child', 'value'], 42);
        expect(entity).toEqual({ scope: { child: { value: 42 } } });
        expect(propertyValueTarget(entity, ['scope', 'child', 'value']).target)
            .toBe(readPropertyPath(entity, ['scope', 'child']));
    });

    it('preserves existing ancestors and rejects a primitive ancestor', () => {
        const scope = { value: 0 };
        const entity = { scope };
        writePropertyPath(entity, ['scope', 'value'], 42);
        expect(entity.scope).toBe(scope);
        expect(scope.value).toBe(42);
        expect(() => {
            writePropertyPath({ scope: 1 }, ['scope', 'value'], 42); 
        })
            .toThrow('Cannot write mapped path \'scope.value\' through non-object segment \'scope\'.');
    });

    it('captures the ancestor sequence before invoking entity getters', () => {
        const path = ['scope', 'child', 'value'];
        const child = { value: 0 };
        const entity = {
            get scope(): { child: { value: number } } {
                path[1] = 'other';
                return { child };
            },
        };
        writePropertyPath(entity, path, 42);
        expect(child.value).toBe(42);
    });

    it('reads own and inherited paths with distinct null and primitive boundaries', () => {
        const entity = Object.create({ inherited: { value: 42 } }) as object;
        expect(readPropertyPath(entity, [])).toBe(entity);
        expect(readPropertyPath(entity, ['inherited', 'value'])).toBe(42);
        expect(readPropertyPath({ scope: null }, ['scope', 'value'])).toBeNull();
        expect(readPropertyPath({}, ['scope', 'value'])).toBeNull();
        expect(readPropertyPath({ scope: 1 }, ['scope', 'value'])).toBeUndefined();
        expect(readPropertyPath({ scope: 'text' }, ['scope', 'length'])).toBeUndefined();
    });

    it('detects own paths and treats null ancestors as present', () => {
        expect(hasPropertyPath({}, [])).toBe(true);
        expect(hasPropertyPath({ scope: { value: undefined } }, ['scope', 'value'])).toBe(true);
        expect(hasPropertyPath({ scope: null }, ['scope', 'value'])).toBe(true);
        expect(hasPropertyPath({ scope: undefined }, ['scope', 'value'])).toBe(false);
        expect(hasPropertyPath({ scope: 1 }, ['scope', 'value'])).toBe(false);
        expect(hasPropertyPath({}, ['value'])).toBe(false);
        expect(hasPropertyPath(Object.create({ value: 1 }) as object, ['value'])).toBe(false);
    });
});
