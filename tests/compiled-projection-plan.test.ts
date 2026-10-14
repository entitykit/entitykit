import { tryCompileProjectionPlan } from '../packages/core/src/core/compiled-projection-plan';
import { isCompiledModelMetadata } from '../packages/core/src/model/compiled-model';
import { EntityMetadata } from '../packages/core/src/model/entity-metadata';
import { Model } from '../packages/core/src/model/model';
import type { StoreValueReader } from '../packages/core/src/storage/store-value-reader';
import { projectionMetadata, projectionQuery, projectionField, ProjectionRow } from './support/compiled-projection';
import { requireDefined } from './support/require-defined';
import * as projectionResults from '../packages/core/src/core/projection-row-materializer';

afterEach(() => jest.restoreAllMocks());

describe('compiled projection field plans', () => {
    it('resolves each field once, independent of returned row count', () => {
        const modelMetadata = projectionMetadata();
        const entityLookup = jest.spyOn(Model.prototype, 'getEntity');
        const propertyLookup = jest.spyOn(EntityMetadata.prototype, 'tryGetProperty');
        const legacyLookup = jest.spyOn(EntityMetadata.prototype, 'getProperty');
        const context = { modelMetadata, valueReader: undefined };
        const plan = requireDefined(tryCompileProjectionPlan(context, ProjectionRow, projectionQuery()));
        const descriptorWrites = jest.spyOn(projectionResults, 'defineResultProperty');
        const input = Array.from({ length: 1000 }, (_, id) => ({ id, label: `row ${String(id)}` }));
        const rows = plan.materializeRows(input);
        expect(rows).toEqual(input);expect(rows[0]).not.toBe(input[0]);expect(rows[0]).not.toBe(rows[1]);
        expect(plan.materializeRows([{ id: 9999, label: 'fresh' }])).toEqual([{ id: 9999, label: 'fresh' }]);
        expect(entityLookup).toHaveBeenCalledTimes(1);expect(propertyLookup).toHaveBeenCalledTimes(2);
        expect(propertyLookup.mock.calls).toEqual([['id'], ['label']]);expect(legacyLookup).not.toHaveBeenCalled();
        expect(descriptorWrites).not.toHaveBeenCalled();
    });

    it('does not infer ownership from a frozen dynamic model', () => {
        const modelMetadata = projectionMetadata(false);Object.freeze(modelMetadata);
        expect(isCompiledModelMetadata(modelMetadata)).toBe(false);
        expect(tryCompileProjectionPlan({ modelMetadata, valueReader: undefined }, ProjectionRow, projectionQuery())).toBeUndefined();
        expect(isCompiledModelMetadata(projectionMetadata())).toBe(true);
    });

    it('keeps per-value reader lookup, receiver, order, nulls and context isolation', () => {
        const modelMetadata = projectionMetadata(), calls: string[] = [];
        const second = { prefix: 'b', readValue(value: unknown, type: string) {
            calls.push(`${this.prefix}:${type}`);return `${this.prefix}:${String(value)}`;
        } };
        const first = { prefix: 'a', readValue(value: unknown, type: string) {
            calls.push(`${this.prefix}:${type}`);reader = second;return `${this.prefix}:${String(value)}`;
        } };
        let reader: StoreValueReader = first;
        const lookup = jest.fn(() => reader);
        const context = { modelMetadata, get valueReader() {
            return lookup();
        } };
        const plan = requireDefined(tryCompileProjectionPlan(context, ProjectionRow, projectionQuery()));
        expect(lookup).not.toHaveBeenCalled();
        expect(plan.materializeRows([{ id: 1, label: 'x' }, { id: null, label: undefined }]))
            .toEqual([{ id: 'a:1', label: 'b:x' }, { id: null, label: undefined }]);
        expect(lookup).toHaveBeenCalledTimes(4);expect(calls).toEqual(['a:integer', 'b:text']);
        const other = requireDefined(tryCompileProjectionPlan({ modelMetadata, valueReader: undefined }, ProjectionRow, projectionQuery()));
        expect(other.materializeRows([{ id: 2, label: 'raw' }])).toEqual([{ id: 2, label: 'raw' }]);
    });

    it.each(['ordinary', '__proto__', 'constructor', 'toString', 'hasOwnProperty'])('owns the output alias %s', alias => {
        const plan = requireDefined(tryCompileProjectionPlan({ modelMetadata: projectionMetadata(), valueReader: undefined }, ProjectionRow, projectionQuery([projectionField(alias, 'label')])));
        const [row] = plan.materializeRows([{ [alias]: 'value' }]);
        expect(Object.getPrototypeOf(row)).toBe(Object.prototype);
        expect(Object.getOwnPropertyDescriptor(row, alias)).toEqual({ value: 'value', writable: true, enumerable: true, configurable: true });
    });

    it('does not invoke a prototype setter installed during reading', () => {
        const alias = '__entitykitCompiledProjectionSetter', setter = jest.fn();
        const context = { modelMetadata: projectionMetadata(), valueReader: { readValue(value: unknown) {
            Object.defineProperty(Object.prototype, alias, { configurable: true, set: setter });return value;
        } } };
        const plan = requireDefined(tryCompileProjectionPlan(context, ProjectionRow, projectionQuery([projectionField(alias, 'label')])));
        try {
            expect(plan.materializeRows([{ [alias]: 'safe' }])).toEqual([{ [alias]: 'safe' }]);
            expect(setter).not.toHaveBeenCalled();
        } finally {
            Reflect.deleteProperty(Object.prototype, alias);
        }
    });

    it('preserves duplicate alias read order and last-write behavior', () => {
        const calls: string[] = [];
        const context = { modelMetadata: projectionMetadata(), valueReader: { readValue(value: unknown, type: string) {
            calls.push(type);return `${type}:${String(value)}`;
        } } };
        const plan = requireDefined(tryCompileProjectionPlan(context, ProjectionRow,
            projectionQuery([projectionField('same', 'id'), projectionField('same', 'label')])));
        expect(plan.materializeRows([{ same: 7 }])).toEqual([{ same: 'text:7' }]);
        expect(calls).toEqual(['integer', 'text']);
    });

    it('retains reader errors and rejects asynchronous values without polluting later results', () => {
        const error = new Error('reader refused'), modelMetadata = projectionMetadata();
        let reader: StoreValueReader = { readValue: () => {
            throw error;
        } };
        const context = { modelMetadata, get valueReader() {
            return reader;
        } };
        const plan = requireDefined(tryCompileProjectionPlan(context, ProjectionRow, projectionQuery()));
        expect(() => plan.materializeRows([{ id: 1, label: 'x' }])).toThrow(error);
        reader = { readValue: async () => Promise.resolve(1) };
        expect(() => plan.materializeRows([{ id: 1, label: 'x' }])).toThrow(/synchronous|Promise/);
        reader = { readValue: value => value };
        expect(plan.materializeRows([{ id: 2, label: 'retry' }])).toEqual([{ id: 2, label: 'retry' }]);
        expect(plan.materializeRows([])).toEqual([]);
    });

    it('declines unknown properties, mismatched entity shapes and unsupported projections', () => {
        const context = { modelMetadata: projectionMetadata(), valueReader: undefined };
        expect(tryCompileProjectionPlan(context, ProjectionRow, projectionQuery([projectionField('missing')]))).toBeUndefined();
        const model = projectionQuery();Reflect.set(model, 'entityType', class Other {});
        expect(tryCompileProjectionPlan(context, ProjectionRow, model)).toBeUndefined();
        const nested = projectionField('label');Reflect.set(nested, 'path', ['nested', 'label']);
        expect(tryCompileProjectionPlan(context, ProjectionRow, projectionQuery([nested]))).toBeUndefined();
    });
});
