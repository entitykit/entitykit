import { compileModel } from '../packages/core/src';
import { compiledModelMetadata } from '../packages/core/src/model/compiled-model';
import { Model } from '../packages/core/src/model/model';
import { ModelBuilder } from '../packages/core/src/model/model-builder';
import type { EntityMetadata } from '../packages/core/src/model/entity-metadata';
import { captureMaterializedValues } from '../packages/core/src/materialization/materialized-value-capture';
import * as snapshots from '../packages/core/src/tracking/snapshot-value-clone';
import { entityReadMetadata, PlannedRow } from './support/compiled-entity';

function renamedMetadata(name: string, column: string): EntityMetadata<PlannedRow> {
    const metadata = entityReadMetadata(false);
    Object.assign(metadata.properties[1], { propertyName: name, propertyPath: [name], columnName: column });
    const source = new Model([metadata as unknown as EntityMetadata]);
    const build = jest.spyOn(ModelBuilder.prototype, 'build').mockReturnValueOnce(source);
    try {
        return compiledModelMetadata(compileModel(() => undefined, { provider: 'sqlite' })).getEntity(PlannedRow);
    } finally {
        build.mockRestore();
    }
}

describe('compiled field capture instructions', () => {
    it.each([
        '__proto__', 'constructor', 'toString', 'quote"\\\n', '\u2028\u2029', '\ud800',
        '"];throw new Error("metadata was code");//',
    ])('preserves literal field and column data %p', name => {
        const column = `column:${name}`, metadata = renamedMetadata(name, column);
        const source = { nested: [1] };
        const row = { id: 1, [column]: source, tail: 2 };
        const result = captureMaterializedValues(metadata, row);
        for (const record of [result.values, result.boundValues]) {
            expect(Object.getPrototypeOf(record)).toBe(Object.prototype);
            expect(Object.hasOwn(record, name)).toBe(true);
            expect(Object.getOwnPropertyDescriptor(record, name)).toEqual({
                value: { nested: [1] }, enumerable: true, configurable: true, writable: true,
            });
            expect(record[name]).not.toBe(source);
        }
        expect(result.values[name]).not.toBe(result.boundValues[name]);
        source.nested.push(9);
        expect(result.values[name]).toEqual({ nested: [1] });
        expect(result.boundValues[name]).toEqual({ nested: [1] });
    });

    it('keeps helper lookups live after a later reader callback', () => {
        const metadata = entityReadMetadata();
        const original = snapshots.cloneSnapshotValue;
        let calls = 0, restore: (() => void) | undefined;
        let result: ReturnType<typeof captureMaterializedValues>;
        try {
            result = captureMaterializedValues(metadata, { id: 1, stored_value: 'value', tail: 2 }, {
                readValue(value, type): unknown {
                    if (type === 'text') {
                        const spy = jest.spyOn(snapshots, 'cloneSnapshotValue').mockImplementation(input => {
                            calls++; return original(input);
                        });
                        restore = () => {
                            spy.mockRestore();
                        };
                    }
                    return value;
                },
            });
        } finally {
            restore?.();
        }
        expect(calls).toBe(6);
        expect(result).toEqual({ values: { id: 1, value: 'value', tail: 2 }, boundValues: { id: 1, value: 'value', tail: 2 } });
    });

    it('keeps captures available when runtime string compilation is forbidden', () => {
        const metadata = entityReadMetadata();
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Function');
        if (!descriptor) throw new Error('Missing Function descriptor.');
        let result: ReturnType<typeof captureMaterializedValues>;
        try {
            Object.defineProperty(globalThis, 'Function', { ...descriptor, value: function (): never {
                throw new EvalError('Code generation from strings disallowed for this context');
            } });
            result = captureMaterializedValues(metadata, { id: 1, stored_value: { nested: [1] }, tail: 2 });
        } finally {
            Object.defineProperty(globalThis, 'Function', descriptor);
        }
        expect(result.values).toEqual({ id: 1, value: { nested: [1] }, tail: 2 });
        expect(result.boundValues).toEqual(result.values);
        expect(result.values.value).not.toBe(result.boundValues.value);
    });

    it('preserves complete values in wide compiled mappings', () => {
        class WideRow {
            [key: string]: unknown;
        }
        const handle = compileModel(model => model.entity(WideRow, entity => {
            entity.toTable('wide_rows').hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer');
            for (let index = 0; index < 70; index++) {
                const key = `field${String(index)}`;
                entity.property(row => row[key]).hasColumnType('text');
            }
        }), { provider: 'sqlite' });
        const source: Record<string, unknown> = { id: 1 };
        for (let index = 0; index < 70; index++) source[`field${String(index)}`] = { nested: [index] };
        const result = captureMaterializedValues(compiledModelMetadata(handle).getEntity(WideRow), source);
        expect(result.values).toEqual(source);
        expect(result.boundValues).toEqual(source);
        for (const key of Object.keys(source).slice(1)) {
            expect(result.values[key]).not.toBe(source[key]);
            expect(result.values[key]).not.toBe(result.boundValues[key]);
        }
    });
});
