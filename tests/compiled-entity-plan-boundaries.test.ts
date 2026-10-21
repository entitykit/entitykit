import { compileModel } from '../packages/core/src';
import { compiledModelMetadata, isCompiledEntityMetadata } from '../packages/core/src/model/compiled-model';
import { copyCompiledModel } from '../packages/core/src/model/compiled-model-copy';
import { Model } from '../packages/core/src/model/model';
import { ModelBuilder } from '../packages/core/src/model/model-builder';
import type { EntityMetadata } from '../packages/core/src/model/entity-metadata';
import { compiledEntityPlan } from '../packages/core/src/materialization/compiled-entity-plan';
import { applyMaterializedValues } from '../packages/core/src/materialization/complex-value-materializer';
import { Materializer } from '../packages/core/src/materialization/materializer';
import { materializedPersistenceFacts } from '../packages/core/src/materialization/materialized-bound-values';
import { entityReadMetadata, PlannedRow } from './support/compiled-entity';
import { requireDefined } from './support/require-defined';

/** Feed unusual finalized metadata through the real copy and ownership boundary. */
function ownMetadata(metadata: EntityMetadata<PlannedRow>): EntityMetadata<PlannedRow> {
    const source = new Model([metadata as unknown as EntityMetadata]);
    const build = jest.spyOn(ModelBuilder.prototype, 'build').mockReturnValueOnce(source);
    try {
        return compiledModelMetadata(compileModel(() => undefined, { provider: 'sqlite' })).getEntity(PlannedRow);
    } finally {
        build.mockRestore();
    }
}

describe('compiled entity plan eligibility and special paths', () => {
    it('registers actual owned copies instead of entities supplied by a live prototype getter', () => {
        const foreign = entityReadMetadata(false);
        const descriptor = requireDefined(Object.getOwnPropertyDescriptor(Model.prototype, 'entities'));
        try {
            Object.defineProperty(Model.prototype, 'entities', { configurable: true, get: () => [foreign] });
            const handle = compileModel(model => model.entity(PlannedRow, entity => {
                entity.toTable('actual_rows').hasKey(row => row.id);
                entity.property(row => row.id).hasColumnType('integer').isRequired();
            }), { provider: 'sqlite' });
            const actual = compiledModelMetadata(handle).getEntity(PlannedRow);
            expect(actual).not.toBe(foreign);expect(Object.isFrozen(actual)).toBe(true);
            expect(isCompiledEntityMetadata(actual)).toBe(true);
            expect(compiledEntityPlan(actual)).toBeDefined();
            expect(Object.isFrozen(foreign)).toBe(false);
            expect(isCompiledEntityMetadata(foreign)).toBe(false);
            expect(compiledEntityPlan(foreign)).toBeUndefined();
        } finally {
            Object.defineProperty(Model.prototype, 'entities', descriptor);
        }
    });

    it('validates copied entity callbacks even if a live getter supplies different metadata', () => {
        const source = entityReadMetadata(false), foreign = entityReadMetadata(false);
        Object.assign(source.properties[1], { converter: { toProvider: PlannedRow, fromProvider: PlannedRow } });
        const model = new Model([source as unknown as EntityMetadata]);
        const descriptor = requireDefined(Object.getOwnPropertyDescriptor(Model.prototype, 'entities'));
        try {
            Object.defineProperty(Model.prototype, 'entities', { configurable: true, get: () => [foreign] });
            expect(() => copyCompiledModel(model)).toThrow('value converters');
        } finally {
            Object.defineProperty(Model.prototype, 'entities', descriptor);
        }
    });

    it('does not accept a deep-frozen copied model without explicit compilation', () => {
        const copied = copyCompiledModel(new Model([entityReadMetadata(false) as unknown as EntityMetadata])).getEntity(PlannedRow);
        expect(Object.isFrozen(copied)).toBe(true);
        expect(isCompiledEntityMetadata(copied)).toBe(false);
        expect(compiledEntityPlan(copied)).toBeUndefined();
        expect(isCompiledEntityMetadata(entityReadMetadata())).toBe(true);
    });

    it.each([[], [''], ['parent', 'value'], [12], { 0: 'value', length: 1 }, new Array<unknown>(1)].map(path => [path]))('declines unsupported mapped path %p', path => {
        const source = entityReadMetadata(false);
        Object.assign(source.properties[1], { propertyPath: path });
        const metadata = ownMetadata(source);
        expect(compiledEntityPlan(metadata)).toBeUndefined();
        expect(compiledEntityPlan(metadata)).toBeUndefined();
        if (Array.isArray(path) && path.length === 2) {
            const target = new PlannedRow();
            applyMaterializedValues(metadata, target, { id: 1, value: 'nested', tail: 2 });
            expect(Reflect.get(target, 'parent')).toEqual({ value: 'nested' });
        }
    });

    it.each(['propertyName', 'propertyPath', 'columnName', 'columnType', 'converter'])('declines missing own property field %s', field => {
        const source = entityReadMetadata(false);
        Reflect.deleteProperty(source.properties[1], field);
        expect(compiledEntityPlan(ownMetadata(source))).toBeUndefined();
    });

    it.each(['entityName', 'materializer', 'checkedMaterializer'])('declines missing own entity field %s', field => {
        const source = entityReadMetadata(false);
        Reflect.deleteProperty(source, field);
        expect(compiledEntityPlan(ownMetadata(source))).toBeUndefined();
    });

    it.each(['propertyName', 'columnName', 'columnType'])('declines non-string %s instead of capturing coercion', field => {
        const source = entityReadMetadata(false);
        Object.assign(source.properties[1], { [field]: 12 });
        expect(compiledEntityPlan(ownMetadata(source))).toBeUndefined();
    });

    it('declines a non-string diagnostic name and absent converter ownership', () => {
        const source = entityReadMetadata(false);
        Object.assign(source, { entityName: 12 });
        expect(compiledEntityPlan(ownMetadata(source))).toBeUndefined();
        const absent = entityReadMetadata(false);
        Reflect.deleteProperty(absent.properties[1], 'converter');
        const owned = ownMetadata(absent);
        expect(compiledEntityPlan(owned)).toBeUndefined();
        expect(compiledEntityPlan(owned)).toBeUndefined();
    });

    it.each(['__proto__', 'constructor', 'toString'])('keeps field names distinct from mapped leaf %s', key => {
        const source = entityReadMetadata(false);
        Object.assign(source.properties[1], { propertyPath: [key] });
        const metadata = ownMetadata(source), target = new PlannedRow();
        expect(compiledEntityPlan(metadata)).toBeDefined();
        applyMaterializedValues(metadata, target, { id: 1, value: 'safe', tail: 2 });
        expect(Object.getPrototypeOf(target)).toBe(PlannedRow.prototype);
        expect(Object.hasOwn(target, key)).toBe(true);expect(Reflect.get(target, key)).toBe('safe');
        expect(Object.getOwnPropertyDescriptor(target, key)).toEqual({
            value: 'safe', configurable: true, enumerable: true, writable: true,
        });
        expect(target.value).toBeUndefined();
    });

    it('owns special capture and persistence keys independently', () => {
        const source = entityReadMetadata(false);
        Object.assign(source.properties[1], { propertyName: '__proto__', propertyPath: ['__proto__'] });
        const metadata = ownMetadata(source);
        const entity = new Materializer().materializeUntracked(metadata, { id: 1, stored_value: { nested: [1] }, tail: 2 });
        const facts = requireDefined(materializedPersistenceFacts(entity));
        for (const record of [entity, facts.values, facts.boundValues]) {
            expect(Object.hasOwn(record, '__proto__')).toBe(true);
            expect(Reflect.get(record, '__proto__')).toEqual({ nested: [1] });
        }
        expect(Object.getPrototypeOf(entity)).toBe(PlannedRow.prototype);
        expect(Object.getPrototypeOf(facts.values)).toBe(Object.prototype);
        expect(facts.values.__proto__).not.toBe(facts.boundValues.__proto__);
        expect(facts.values.__proto__).not.toBe(Reflect.get(entity, '__proto__'));
    });

    it('checks readback after a proxy claims to define the special leaf', () => {
        const source = entityReadMetadata(false);
        Object.assign(source.properties[1], { propertyPath: ['__proto__'] });
        const metadata = ownMetadata(source);
        const define = jest.fn();
        const entity = new Proxy(new PlannedRow(), { defineProperty(object, key, descriptor) {
            define(key);return key === '__proto__' || Reflect.defineProperty(object, key, descriptor);
        } });
        expect(() => {
            applyMaterializedValues(metadata, entity, { id: 1, value: 'safe', tail: 2 });
        })
            .toThrow('Property \'PlannedRow.value\' refused its assigned value.');
        expect(entity.id).toBe(1);expect(entity.tail).toBe(0);
        expect(define).toHaveBeenCalledTimes(2);
    });
});
