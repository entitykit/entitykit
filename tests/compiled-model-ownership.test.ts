import { compileModel, type CompiledModel, type EntityBuilder, type ModelBuilder, type PropertyBuilder } from '../packages/core/src';
import { compiledModelMetadata } from '../packages/core/src/model/compiled-model';
import { copyCompiledModel } from '../packages/core/src/model/compiled-model-copy';
import { ModelBuilder as InternalModelBuilder } from '../packages/core/src/model/model-builder';

class Row {
    public id = 0; public name = '';
}
function configure(model: ModelBuilder): void {
    model.entity(Row, entity => {
        entity.toTable('rows').hasKey(row => row.id);
        entity.property(row => row.id).hasColumnType('integer').isRequired();
        entity.property(row => row.name).hasColumnType('text').isRequired();
    });
}

describe('compiled model ownership', () => {
    it('owns metadata and nested paths independently of retained builders', () => {
        let retained!: EntityBuilder<Row>;
        let name!: PropertyBuilder<string>;
        const callback = jest.fn((model: ModelBuilder) => {
            configure(model);
            model.entity(Row, entity => {
                retained = entity; name = entity.property(row => row.name);
            });
        });
        const handle = compileModel(callback, { provider: 'sqlite' });
        const model = compiledModelMetadata(handle);
        const metadata = model.getEntity(Row);
        retained.toTable('changed');name.hasColumnName('changed').hasDefaultValue('later');
        expect(callback).toHaveBeenCalledTimes(1);
        expect(metadata.tableName).toBe('rows');
        expect(metadata.getProperty('name').columnName).toBe('name');
        expect(metadata.getProperty('name').defaultValue).toBeUndefined();
        expect(Object.isFrozen(handle)).toBe(true);
        expect(Object.isFrozen(model)).toBe(true);
        expect(Object.isFrozen(metadata)).toBe(true);
        expect(Object.isFrozen(metadata.properties)).toBe(true);
        expect(Array.isArray(metadata.properties)).toBe(true);
        expect(Array.isArray(metadata.keyProperties)).toBe(true);
        expect(Object.isFrozen(metadata.getProperty('name').propertyPath)).toBe(true);
        const path = metadata.getProperty('name').propertyPath;
        expect(Array.isArray(path)).toBe(true);
        expect(Object.getOwnPropertyDescriptor(path, '0')).toEqual({
            value: 'name', enumerable: true, writable: false, configurable: false,
        });
        expect(Reflect.set(path, 'length', 0)).toBe(false);
        expect(() => Object.defineProperty(path, '0', { value: 'other' })).toThrow(TypeError);
        expect(() => Object.assign(metadata, { tableName: 'other' })).toThrow(TypeError);
        expect(() => Object.assign(metadata.getProperty('name').propertyPath, { 0: 'other' })).toThrow(TypeError);
        expect(Object.isFrozen(Row)).toBe(false);
        expect(Object.isFrozen(Row.prototype)).toBe(false);
        expect(Object.isFrozen(retained)).toBe(false);
        expect(model.entities).not.toBe(model.entities);
        expect(metadata.keyPropertyMetadata).toBe(metadata.getProperty('id'));
    });

    it('hides lookup mutators even when internal fields and forEach are inspected', () => {
        const model = compiledModelMetadata(compileModel(configure, { provider: 'sqlite' }));
        const lookup = Reflect.get(model, 'entitiesByConstructor') as ReadonlyMap<unknown, unknown>;
        expect(lookup.size).toBe(1);expect(lookup.has(Row)).toBe(true);
        expect(lookup.get(Row)).toBe(model.getEntity(Row));
        expect(Reflect.get(lookup, 'set')).toBeUndefined();
        expect(Reflect.get(lookup, 'delete')).toBeUndefined();
        expect(Reflect.get(lookup, 'clear')).toBeUndefined();
        expect(Object.prototype.toString.call(lookup)).toBe('[object CompiledModelMap]');
        expect(Object.isFrozen(Object.getPrototypeOf(lookup))).toBe(true);
        expect(() => Map.prototype.set.call(lookup, Row, null)).toThrow(TypeError);
        const receiver = {};
        const visited: unknown[] = [];
        lookup.forEach(function(this: object, value, key, map) {
            visited.push(key);
            expect(this).toBe(receiver);expect(map).toBe(lookup);
            expect(key).toBe(Row);expect(value).toBe(model.getEntity(Row));
        }, receiver);
        expect(visited).toEqual([Row]);
        expect([...lookup.keys()]).toEqual([Row]);
        expect([...lookup.values()]).toEqual([model.getEntity(Row)]);
        const entries = [...lookup.entries()];entries[0][1] = null;
        expect([...lookup][0][1]).toBe(model.getEntity(Row));
        const properties = Reflect.get(model.getEntity(Row), 'propertiesByName') as ReadonlyMap<string, unknown>;
        expect(properties.get('id')).toBe(model.getEntity(Row).keyPropertyMetadata);
        expect(Reflect.get(properties, 'set')).toBeUndefined();
    });

    it('keeps separate explicit variants separate and rejects forged handles', () => {
        const first = compileModel(configure, { provider: 'sqlite' });
        const second = compileModel(model => {
            configure(model);model.entity(Row, entity => entity.toTable('variant'));
        }, { provider: 'sqlite' });
        expect(first).not.toBe(second);
        expect(compiledModelMetadata(first).getEntity(Row).tableName).toBe('rows');
        expect(compiledModelMetadata(second).getEntity(Row).tableName).toBe('variant');
        expect(() => compiledModelMetadata({ provider: 'sqlite', dialect: 'sqlite' } as CompiledModel)).toThrow('returned by compileModel');
        expect(() => compiledModelMetadata(new Proxy(first, {}))).toThrow('returned by compileModel');
    });

    it.each([
        { provider: '' }, { provider: ' ' }, { provider: undefined }, { provider: 42 },
        { provider: '', dialect: 'sqlite' }, { provider: ' ', dialect: 'sqlite' },
        { provider: 'sqlite', dialect: ' ' }, { provider: 'sqlite', dialect: 42 },
    ])('validates names before running configuration: %p', options => {
        const callback = jest.fn();
        expect(() => compileModel(callback, options as { provider: string; dialect?: string })).toThrow('nonempty');
        expect(callback).not.toHaveBeenCalled();
    });

    it('rejects asynchronous configuration and unsupported shared callbacks/defaults', () => {
        expect(() => compileModel(async () => Promise.resolve(), { provider: 'sqlite' })).toThrow('synchronous');
        expect(() => compileModel(model => {
            configure(model);model.entity(Row, entity => entity.property(row => row.name).hasDefaultValue({ nested: [] }));
        }, { provider: 'sqlite' })).toThrow('object or function defaults');
        expect(() => compileModel(model => {
            configure(model);model.entity(Row, entity => entity.property(row => row.name).hasDefaultValue(Row));
        }, { provider: 'sqlite' })).toThrow('Unsupported default value');
        expect(() => compileModel(model => {
            configure(model);model.entity(Row, entity => entity.property(row => row.name).hasConversion({
                toProvider: value => value, fromProvider: value => value,
            }));
        }, { provider: 'sqlite' })).toThrow('shared callbacks');
    });

    it('rejects metadata accessors without invoking them and leaves legacy data mutable', () => {
        const builder = new InternalModelBuilder();configure(builder);
        const source = builder.build(), property = source.getEntity(Row).getProperty('name');
        const getter = jest.fn(() => 'hidden');
        Object.defineProperty(property, 'defaultValue', { get: getter, configurable: true });
        expect(() => copyCompiledModel(source)).toThrow('metadata accessors');
        expect(getter).not.toHaveBeenCalled();
        expect(Object.isFrozen(source)).toBe(false);expect(Object.isFrozen(property)).toBe(false);
    });

    it('refuses a function default introduced into finalized metadata', () => {
        const builder = new InternalModelBuilder();configure(builder);
        const source = builder.build();
        Object.assign(source.getEntity(Row).getProperty('name'), { defaultValue: Row });
        expect(() => copyCompiledModel(source)).toThrow('object or function defaults');
    });

    it('rejects proxied metadata without invoking its traps', () => {
        const builder = new InternalModelBuilder();configure(builder);
        const source = builder.build(), trap = jest.fn(() => []);
        Object.assign(source.getEntity(Row).getProperty('name'), { propertyPath: new Proxy(['name'], { ownKeys: trap }) });
        expect(() => copyCompiledModel(source)).toThrow('proxied metadata');
        expect(trap).not.toHaveBeenCalled();
    });

    it('validates provider-specific physical index names before returning a handle', () => {
        const indexed = (model: ModelBuilder): void => {
            configure(model);
            model.entity(Row, entity => {
                entity.hasIndex(row => row.id).hasDatabaseName('IX_rows');
                entity.hasIndex(row => row.name).hasDatabaseName('ix_rows');
            });
        };
        expect(() => compileModel(indexed, { provider: 'sqlite' })).toThrow('multiple indexes');
        expect(() => compileModel(indexed, { provider: 'postgres' })).not.toThrow();
    });

    it('captures compatibility names before caller configuration can change its options', () => {
        const options = { provider: 'sqlite', dialect: 'sqlite' };
        const handle = compileModel(model => {
            configure(model);options.provider = 'other';options.dialect = 'other';
        }, options);
        expect(handle.provider).toBe('sqlite');expect(handle.dialect).toBe('sqlite');
    });
});
