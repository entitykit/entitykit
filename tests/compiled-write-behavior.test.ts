import { compileModel } from '../packages/core/src';
import { compiledModelMetadata } from '../packages/core/src/model/compiled-model';
import { Model } from '../packages/core/src/model/model';
import { ModelBuilder } from '../packages/core/src/model/model-builder';
import type { EntityMetadata } from '../packages/core/src/model/entity-metadata';
import { Materializer } from '../packages/core/src/materialization/materializer';
import { materializedPersistenceFacts } from '../packages/core/src/materialization/materialized-bound-values';
import { entityReadMetadata, PlannedRow } from './support/compiled-entity';
import { requireDefined } from './support/require-defined';

function renamedMetadata(name: string, key = name): EntityMetadata<PlannedRow> {
    const metadata = entityReadMetadata(false);
    Object.assign(metadata.properties[1], { propertyName: name, propertyPath: [key], columnName: `column:${name}` });
    const source = new Model([metadata as unknown as EntityMetadata]);
    const build = jest.spyOn(ModelBuilder.prototype, 'build').mockReturnValueOnce(source);
    try {
        return compiledModelMetadata(compileModel(() => undefined, { provider: 'sqlite' })).getEntity(PlannedRow);
    } finally {
        build.mockRestore();
    }
}

describe('compiled verified writes through materialization', () => {
    it.each([
        '__proto__', 'constructor', 'toString', 'quote"\\\n', '\u2028\u2029', '\ud800',
        '"];throw new Error("metadata was code");//',
    ])('treats mapped names as literal data during writes: %p', name => {
        const source = { nested: [1] };
        const metadata = renamedMetadata(name);
        const entity = new Materializer().materializeUntracked(metadata, { id: 1, [`column:${name}`]: source, tail: 2 });
        expect(Object.getPrototypeOf(entity)).toBe(PlannedRow.prototype);
        const descriptor = requireDefined(Object.getOwnPropertyDescriptor(entity, name));
        expect(descriptor).toEqual({ value: { nested: [1] }, writable: true, configurable: true, enumerable: true });
        expect(descriptor.value).not.toBe(source);
        source.nested.push(9);
        expect(descriptor.value).toEqual({ nested: [1] });
        expect(requireDefined(materializedPersistenceFacts(entity)).values[name]).toEqual({ nested: [1] });
    });

    it('keeps the capture name separate from its entity property path', () => {
        const metadata = renamedMetadata('captured', 'target');
        const entity = new Materializer().materializeUntracked(metadata, { id: 1, 'column:captured': 'value', tail: 2 });
        expect(Object.getOwnPropertyDescriptor(entity, 'target')?.value).toBe('value');
        expect(Object.hasOwn(entity, 'captured')).toBe(false);
        expect(requireDefined(materializedPersistenceFacts(entity)).values.captured).toBe('value');
    });

    it.each([false, true])('preserves application copy/setter/readback order, compiled=%p', compiled => {
        const events: string[] = [];
        class Bytes extends Uint8Array {
            constructor(buffer: ArrayBuffer) {
                super(buffer);
                events.push('copy');
            }
        }
        class Row extends PlannedRow {
            constructor() {
                super();events.push('construct');
                let current: unknown;
                Object.defineProperty(this, 'value', {
                    configurable: true,
                    get: () => {
                        events.push('get');return current;
                    },
                    set: (value: unknown) => {
                        events.push('set');current = value;
                    },
                });
            }
        }
        const input = new Bytes(Uint8Array.from([1, 2]).buffer);
        events.length = 0;
        const entity = new Materializer().materializeUntracked(entityReadMetadata(compiled, Row),
            { id: 1, stored_value: input, tail: 2 });
        expect(events).toEqual(['copy', 'copy', 'copy', 'construct', 'copy', 'set', 'get', 'copy', 'copy']);
        expect([...(entity.value as Uint8Array)]).toEqual([1, 2]);
        expect(input[0]).toBe(1);
    });

    it.each([false, true])('preserves proxy write refusal and failed-instance reservation, compiled=%p', compiled => {
        const events: string[] = [];
        let reused: PlannedRow | undefined;
        class Row extends PlannedRow {
            constructor() {
                super();
                if (reused) return reused;
                reused = new Proxy(this, {
                    set(target, key, value, receiver): boolean {
                        events.push(`set:${String(key)}`);
                        return key === 'id' ? false : Reflect.set(target, key, value, receiver);
                    },
                    get(target, key, receiver): unknown {
                        if (key === 'id') events.push('get:id');
                        return Reflect.get(target, key, receiver);
                    },
                });
                return reused;
            }
        }
        const metadata = entityReadMetadata(compiled, Row), materializer = new Materializer();
        const input = { id: 1, stored_value: 'value', tail: 2 };
        expect(() => materializer.materializeUntracked(metadata, input)).toThrow('Cannot write mapped property \'id\'.');
        expect(events).toEqual(['set:id']);
        expect(materializedPersistenceFacts(requireDefined(reused))).toBeUndefined();
        expect(() => materializer.materializeUntracked(metadata, input)).toThrow('already used for another database row');
        expect(events).toEqual(['set:id']);
    });

    it('keeps verified writes available when string compilation is forbidden', () => {
        const metadata = entityReadMetadata();
        const descriptor = requireDefined(Object.getOwnPropertyDescriptor(globalThis, 'Function'));
        let entity: PlannedRow;
        try {
            Object.defineProperty(globalThis, 'Function', { ...descriptor, value: function (): never {
                throw new EvalError('Code generation from strings disallowed for this context');
            } });
            entity = new Materializer().materializeUntracked(metadata, { id: 1, stored_value: { nested: [1] }, tail: 2 });
        } finally {
            Object.defineProperty(globalThis, 'Function', descriptor);
        }
        expect(entity.value).toEqual({ nested: [1] });
        (entity.value as { nested: number[] }).nested.push(9);
        expect(requireDefined(materializedPersistenceFacts(entity)).values.value).toEqual({ nested: [1] });
    });
});
