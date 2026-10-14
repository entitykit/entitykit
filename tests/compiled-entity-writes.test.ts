import { applyMaterializedValues } from '../packages/core/src/materialization/complex-value-materializer';
import { compiledEntityPlan } from '../packages/core/src/materialization/compiled-entity-plan';
import { Materializer } from '../packages/core/src/materialization/materializer';
import { materializedPersistenceFacts } from '../packages/core/src/materialization/materialized-bound-values';
import { EntityMetadata } from '../packages/core/src/model/entity-metadata';
import { RestorationScope } from '../packages/core/src/restoration-scope';
import * as verified from '../packages/core/src/verified-property-write';
import * as snapshots from '../packages/core/src/tracking/snapshot-value-clone';
import * as conversions from '../packages/core/src/model/value-converter/store-value';
import { entityReadMetadata, PlannedRow } from './support/compiled-entity';
import { requireDefined } from './support/require-defined';

describe('compiled entity field writes', () => {
    afterEach(() => jest.restoreAllMocks());

    it('owns reusable mapping decisions without caching by constructor or frozen shape', () => {
        const first = entityReadMetadata(), second = entityReadMetadata();
        const plan = requireDefined(compiledEntityPlan(first));
        expect(compiledEntityPlan(first)).toBe(plan);
        expect(compiledEntityPlan(second)).not.toBe(plan);
        expect(Object.isFrozen(plan)).toBe(true);
        expect(plan.every(Object.isFrozen)).toBe(true);
        expect(plan.map(field => [field.name, field.key, field.context])).toEqual([
            ['id', 'id', 'PlannedRow.id'], ['value', 'value', 'PlannedRow.value'], ['tail', 'tail', 'PlannedRow.tail'],
        ]);
        const dynamic = entityReadMetadata(false);Object.freeze(dynamic);
        expect(compiledEntityPlan(dynamic)).toBeUndefined();
        expect(compiledEntityPlan(Object.assign({}, first))).toBeUndefined();
    });

    it('removes repeated generic writes and retention lookups without removing snapshot copies', () => {
        const dynamic = entityReadMetadata(false), compiled = entityReadMetadata();
        const write = jest.spyOn(verified, 'writeVerifiedProperty');
        const lookup = jest.spyOn(EntityMetadata.prototype, 'tryGetProperty');
        const clone = jest.spyOn(snapshots, 'cloneSnapshotValue');
        const convert = jest.spyOn(conversions, 'fromProviderValue');
        const materializer = new Materializer();
        for (let id = 0; id < 100; id++) materializer.materializeUntracked(dynamic, { id, stored_value: 'value', tail: 9 });
        expect(write).toHaveBeenCalledTimes(300);expect(lookup).toHaveBeenCalledTimes(300);
        expect(convert).toHaveBeenCalledTimes(300);
        const copies = clone.mock.calls.length;
        write.mockClear();lookup.mockClear();clone.mockClear();convert.mockClear();
        for (let id = 0; id < 100; id++) materializer.materializeUntracked(compiled, { id, stored_value: 'value', tail: 9 });
        expect(write).not.toHaveBeenCalled();expect(lookup).not.toHaveBeenCalled();
        expect(convert).not.toHaveBeenCalled();
        expect(clone).toHaveBeenCalledTimes(copies);
    });

    it.each([undefined, null, NaN, -0, 0, false, '', 12n, Symbol('value')])('preserves primitive comparison for %p', value => {
        const entity = new PlannedRow();
        applyMaterializedValues(entityReadMetadata(), entity, { id: 1, value, tail: 2 });
        expect(Object.is(entity.value, value)).toBe(true);
    });

    it.each([false, true])('preserves ordered setter/readback effects, proxy %s', proxy => {
        const observations: string[][] = [];
        for (const compiled of [false, true]) {
            const events: string[] = [];
            const target = new PlannedRow();
            let stored: unknown;
            Object.defineProperty(target, 'value', {
                get: () => {
                    events.push('get');return stored;
                },
                set: (value: unknown) => {
                    events.push('set');stored = { nested: [...(value as { nested: number[] }).nested] };
                },
            });
            const entity = proxy ? new Proxy(target, {
                set: (object, key, value, receiver) => {
                    events.push(`proxy set ${String(key)}`);return Reflect.set(object, key, value, receiver);
                },
                get: (object, key, receiver) => {
                    events.push(`proxy get ${String(key)}`);return Reflect.get(object, key, receiver) as unknown;
                },
            }) : target;
            applyMaterializedValues(entityReadMetadata(compiled), entity, { id: 1, value: { nested: [1] }, tail: 2 });
            observations.push(events);
            expect(stored).toEqual({ nested: [1] });
        }
        expect(observations[1]).toEqual(observations[0]);
        expect(observations[0]).toContain('set');expect(observations[0]).toContain('get');
    });

    it.each(['refuse', 'mutate', 'throw', 'readonly', 'getThrow', 'falseProxy'])('retains failure and partial state: %s', kind => {
        const observations: unknown[] = [];
        for (const compiled of [false, true]) {
            const target = new PlannedRow();
            const input = { nested: [1] };
            let stored: unknown;
            Object.defineProperty(target, 'value', kind === 'readonly' ? { value: 'before', writable: false } : {
                get: () => {
                    if (kind === 'getThrow') throw new Error('getter failed');
                    return stored;
                },
                set: (value: unknown) => {
                    if (kind === 'refuse') return;
                    stored = value;
                    if (kind === 'mutate') (value as typeof input).nested.push(2);
                    if (kind === 'throw') throw new Error('setter failed');
                },
            });
            const entity = kind === 'falseProxy' ? new Proxy(target, {
                set: (object, key, value, receiver) => key !== 'value' && Reflect.set(object, key, value, receiver),
            }) : target;
            let failure: unknown;
            try {
                applyMaterializedValues(entityReadMetadata(compiled), entity, { id: 7, value: input, tail: 2 });
            } catch (error) {
                failure = error;
            }
            expect(failure).toBeInstanceOf(Error);
            observations.push({ message: (failure as Error).message, id: target.id, tail: target.tail, stored, input });
            expect(target.id).toBe(7);expect(target.tail).toBe(0);
        }
        expect(observations[1]).toEqual(observations[0]);
    });

    it('preserves the legacy function-instance readback boundary', () => {
        for (const compiled of [false, true]) {
            const entity = (): void => undefined;
            expect(() => {
                applyMaterializedValues(entityReadMetadata(compiled), entity as unknown as PlannedRow, { id: 1 });
            })
                .toThrow('Property \'PlannedRow.id\' refused its assigned value.');
            expect(Reflect.get(entity, 'id')).toBe(1);
        }
    });

    it('keeps restoration on the failure-atomic path', () => {
        const entity = new PlannedRow(), scope = new RestorationScope(() => undefined);
        let stored: unknown = 'before';
        Object.defineProperty(entity, 'value', {
            get: () => stored,
            set: (value: unknown) => {
                stored = value;if (value === 'after') throw new Error('failed');
            },
        });
        expect(() => {
            applyMaterializedValues(entityReadMetadata(), entity, { id: 7, value: 'after' }, scope);
        }).toThrow('failed');
        expect(stored).toBe('before');
        expect(() => scope.rethrowPrimary()).toThrow('failed');
        expect(() => {
            scope.throwIfFailed();
        }).not.toThrow();
    });

    it('retains isolated typed facts after caller, entity and returned-fact mutations', () => {
        const metadata = entityReadMetadata(), raw = { nested: [new Date(0), new Uint8Array([1, 2])] };
        const entity = new Materializer().materializeUntracked(metadata, { id: 1, stored_value: raw, tail: 2 });
        const initial = requireDefined(materializedPersistenceFacts(entity));
        (entity.value as { nested: unknown[] }).nested.length = 0;
        raw.nested.length = 0;
        (initial.values.value as { nested: unknown[] }).nested.length = 0;
        (initial.boundValues.value as { nested: unknown[] }).nested.length = 0;
        const next = requireDefined(materializedPersistenceFacts(entity));
        expect(next.values.value).toEqual({ nested: [new Date(0), new Uint8Array([1, 2])] });
        expect(next.boundValues.value).toEqual(next.values.value);
        expect(next.boundValues.value).not.toBe(next.values.value);
    });
});
