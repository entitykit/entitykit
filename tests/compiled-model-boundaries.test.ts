import {
    compileModel, ModelValidationError, type ModelBuilder,
} from '../packages/core/src';
import { compiledModelMetadata, validateCompiledModelProvider } from '../packages/core/src/model/compiled-model';
import { copyCompiledModel } from '../packages/core/src/model/compiled-model-copy';
import type { Model } from '../packages/core/src/model/model';
import { ModelBuilder as InternalModelBuilder } from '../packages/core/src/model/model-builder';
import { DbContextOptionsBuilder } from '../packages/core/src/core/context-options/db-context-options-builder';
import { createSqliteDataSource } from '../packages/sqlite/src';

class Row {
    public id = 0;
    public name = '';
    public nested?: { value: string };
}
function configure(model: ModelBuilder): void {
    model.entity(Row, entity => {
        entity.toTable('rows').hasKey(row => row.id);
        entity.property(row => row.id).hasColumnType('integer').isRequired();
        entity.property(row => row.name).hasColumnType('text');
    });
}
function legacyModel(): Model {
    const builder = new InternalModelBuilder();configure(builder);
    return builder.build();
}
function failure(action: () => unknown): ModelValidationError {
    try {
        action();
    } catch (error) {
        if (error instanceof ModelValidationError) return error;
        throw error;
    }
    throw new Error('Expected a model validation error');
}

describe('compiled model boundary contracts', () => {
    it.each([null, '', 'default', 0, false, 42n])('preserves supported primitive defaults: %p', value => {
        const handle = compileModel(model => {
            configure(model);
            model.entity(Row, entity => entity.property(row => row.name).hasDefaultValue(value));
        }, { provider: 'sqlite' });
        expect(compiledModelMetadata(handle).getEntity(Row).getProperty('name').defaultValue).toBe(value);
        expect(handle).toEqual({ provider: 'sqlite', dialect: 'sqlite' });
    });

    it('preserves lookup aliases, cyclic metadata and sparse array lengths without sharing mutable storage', () => {
        const source = legacyModel(), metadata = source.getEntity(Row);
        const lookup = Reflect.get(source, 'entitiesByConstructor') as Map<unknown, unknown>;
        const sparse: unknown[] = new Array<unknown>(3);sparse[1] = 'unused';
        Object.assign(metadata, { lookup, annotations: Object.assign(Object.create(null) as object, { sparse }) });
        const model = copyCompiledModel(source), owned = model.getEntity(Row);
        const ownLookup = Reflect.get(model, 'entitiesByConstructor') as ReadonlyMap<unknown, unknown>;
        expect(Reflect.get(owned, 'lookup')).toBe(ownLookup);
        const ownProperties: unknown = Reflect.get(owned, 'propertiesByName');
        expect(Reflect.get(Reflect.get(owned, 'keyMetadata') as object, 'propertiesByName')).toBe(ownProperties);
        const annotations = Reflect.get(owned, 'annotations') as { sparse: unknown[] };
        expect(Object.getPrototypeOf(annotations)).toBeNull();
        expect(annotations.sparse).toHaveLength(3);
        expect(0 in annotations.sparse).toBe(false);expect(1 in annotations.sparse).toBe(true);
        expect(Object.isFrozen(annotations.sparse)).toBe(true);
        sparse[1] = 'changed';lookup.clear();
        expect(annotations.sparse[1]).toBe('unused');expect(ownLookup.get(Row)).toBe(owned);
    });

    it('refuses customized lookup objects and metadata prototypes', () => {
        const source = legacyModel();
        const lookup = Reflect.get(source, 'entitiesByConstructor') as object;
        Object.defineProperty(lookup, 'extra', { value: 1 });
        expect(() => copyCompiledModel(source)).toThrow('custom lookup properties');
        const other = legacyModel();
        Object.setPrototypeOf(other.getEntity(Row).getProperty('name'), { mutable: true });
        expect(() => copyCompiledModel(other)).toThrow('custom metadata prototypes');
    });

    it('rejects complex mappings even without custom constructors or callbacks', () => {
        expect(() => compileModel(model => {
            configure(model);
            model.entity(Row, entity => entity.complexProperty(row => row.nested, nested => {
                nested.property(value => value.value).hasColumnType('text');
            }));
        }, { provider: 'sqlite' })).toThrow('custom materializers and complex properties');
    });

    it.each(['materializer', 'checkedMaterializer'])('refuses a registered constructor reused as %s metadata', field => {
        const source = legacyModel();
        Object.assign(source.getEntity(Row), { [field]: Row });
        expect(() => copyCompiledModel(source)).toThrow('custom materializers and complex properties');
    });

    it('refuses converter metadata even when its functions are registered constructors', () => {
        const source = legacyModel();
        Object.assign(source.getEntity(Row).getProperty('name'), { converter: { toProvider: Row, fromProvider: Row } });
        const error = failure(() => copyCompiledModel(source));
        expect(error.message).toContain('value converters');
        expect(error.details).toEqual({ contractViolation: 'unsupportedCompiledModel' });
    });

    it('reports the synchronous callback contract and compatibility names', () => {
        const error = failure(() => compileModel(async () => Promise.resolve(), { provider: 'sqlite' }));
        expect(error.message).toContain('compileModel()');
        expect(error.details).toEqual({ contractViolation: 'asyncCompiledModel' });
        const handle = compileModel(configure, { provider: 'custom', dialect: 'sqlite' });
        expect(() => {
            validateCompiledModelProvider(handle, 'custom', 'sqlite');
        }).not.toThrow();
        const mismatch = failure(() => {
            validateCompiledModelProvider(handle, 'sqlite', 'sqlite');
        });
        expect(mismatch.message).toContain('requires provider \'custom\' and dialect \'sqlite\'');
        expect(mismatch.message).toContain('but this context uses \'sqlite\' and \'sqlite\'');
        expect(mismatch.details).toEqual({ contractViolation: 'compiledModelProviderMismatch' });
    });

    it('refuses a different model before leasing even when its mapping is identical', async () => {
        const source = createSqliteDataSource(':memory:');
        const acquire = jest.spyOn(source, 'createConnection');
        const handle = compileModel(configure, { provider: 'sqlite' });
        const options = new DbContextOptionsBuilder().useDataSource(source).useCompiledModel(handle);
        expect(() => options.build(legacyModel())).toThrow('differs from its selected compiled model');
        expect(acquire).not.toHaveBeenCalled();
        await source.dispose();
    });
});
