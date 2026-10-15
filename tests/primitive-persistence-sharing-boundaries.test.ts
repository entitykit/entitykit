import {
    materializedPersistenceFacts,
    rememberMaterializedPersistenceFacts,
    reserveMaterializedEntity,
} from '../packages/core/src/materialization/materialized-bound-values';
import { Materializer } from '../packages/core/src/materialization/materializer';
import { ChangeTracker } from '../packages/core/src/tracking/change-tracker';
import { QueryIdentityResolution, useQueryIdentityResolution } from '../packages/core/src/materialization/query-identity-resolution';
import { entityReadMetadata } from './support/compiled-entity';
import { requireDefined } from './support/require-defined';

describe.each([false, true])('primitive persistence record boundaries, compiled=%s', compiled => {
    it('keeps source, public capture and every returned fact record independent', () => {
        const metadata = entityReadMetadata(compiled);
        const materializer = useQueryIdentityResolution(new Materializer(), new QueryIdentityResolution());
        const raw = { id: 1, stored_value: 'original', tail: 2 };
        const capture = materializer.materializeWithValues(metadata, raw, new ChangeTracker());
        raw.stored_value = 'raw';
        capture.entity.value = 'entity';
        Reflect.set(capture.values, 'value', 'capture');Reflect.set(capture.boundValues, 'value', 'bound');
        Reflect.deleteProperty(capture.values, 'tail');Reflect.set(capture.boundValues, 'extra', true);
        const first = requireDefined(materializedPersistenceFacts(capture.entity));
        expect(first.values).toEqual({ id: 1, value: 'original', tail: 2 });
        expect(first.boundValues).toEqual(first.values);
        expect(first.values).not.toBe(first.boundValues);
        first.values.value = 'returned';Reflect.deleteProperty(first.boundValues, 'tail');
        expect(first.boundValues.value).toBe('original');
        expect(first.values.tail).toBe(2);
        const second = requireDefined(materializedPersistenceFacts(capture.entity));
        expect(second.values).toEqual({ id: 1, value: 'original', tail: 2 });
        expect(second.boundValues).toEqual(second.values);
        expect(second.values).not.toBe(first.values);
        expect(second.boundValues).not.toBe(first.boundValues);
    });

    it('preserves special primitive values, key order and separate model/bound state', () => {
        const symbol = Symbol('primitive');
        const model: Record<string, unknown> = { '10': undefined, '2': null, value: NaN, zero: -0, flag: false, big: 4n, symbol };
        Object.defineProperty(model, '__proto__', { configurable: true, enumerable: true, writable: true, value: 'safe' });
        const bound = { ...model, zero: 0 };
        const entity = {};
        rememberMaterializedPersistenceFacts(entity, entityReadMetadata(compiled), model, bound);
        const facts = requireDefined(materializedPersistenceFacts(entity));
        expect(Object.keys(facts.values)).toEqual(Object.keys(model));
        expect(Object.keys(facts.boundValues)).toEqual(Object.keys(bound));
        expect(facts.values).toEqual(model);expect(facts.boundValues).toEqual(bound);
        expect(Object.is(facts.values.zero, -0)).toBe(true);
        expect(Object.is(facts.boundValues.zero, 0)).toBe(true);
        expect(Object.hasOwn(facts.values, '__proto__')).toBe(true);
        expect(Object.getPrototypeOf(facts.values)).toBe(Object.prototype);
    });

    it('captures root getters before copying mutable values and retains changed model values', () => {
        const events: string[] = [];
        const value = { nested: 1 };
        const model = {
            get scalarFirst(): number {
                events.push('first');return 1; 
            },
            get graph(): object {
                events.push('graph');return value; 
            },
            get scalarTail(): number {
                events.push('tail');value.nested = 9;return 2; 
            },
        };
        const entity = {};
        rememberMaterializedPersistenceFacts(entity, entityReadMetadata(compiled), model, { scalarFirst: 1, graph: 'original', scalarTail: 2 });
        expect(events).toEqual(['first', 'graph', 'tail']);
        value.nested = 20;
        const facts = requireDefined(materializedPersistenceFacts(entity));
        expect(facts.values).toEqual({ scalarFirst: 1, graph: { nested: 9 }, scalarTail: 2 });
        expect(facts.boundValues.graph).toBe('original');
    });

    it.each(['setter', 'readonly', 'drop', 'reverse', 'duplicate', 'change'])(
        'preserves a model-entry iterator that introduces %s behavior', kind => {
            const metadata = entityReadMetadata(compiled), entity = {};
            const source = { scalarFirst: 1, scalarTail: 2 };
            const iterator = Array.prototype[Symbol.iterator];
            const iteratorDescriptor = requireDefined(Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator));
            const tailDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, 'scalarTail');
            let intercepted = false, failure: unknown;
            const observed: Array<{ keys: string[]; value: unknown }> = [];
            reserveMaterializedEntity(entity);
            Object.defineProperty(Array.prototype, Symbol.iterator, {
                ...iteratorDescriptor,
                value: function* (this: unknown[]): Generator {
                    const first: unknown = this[0], tail: unknown = this[1];
                    if (!intercepted && Array.isArray(first) && first[0] === 'scalarFirst' && Array.isArray(tail)) {
                        intercepted = true;
                        if (kind === 'reverse') {
                            yield tail;yield first;return; 
                        }
                        yield first;
                        if (kind === 'drop') return;
                        if (kind === 'setter') Object.defineProperty(Object.prototype, 'scalarTail', {
                            configurable: true,
                            set(this: object, value: unknown) {
                                observed.push({ keys: Object.keys(this), value });
                                Object.defineProperty(this, 'scalarTail', { configurable: true, enumerable: true, writable: true, value: 8 });
                            },
                        });
                        if (kind === 'readonly') Object.defineProperty(Object.prototype, 'scalarTail', { configurable: true, value: 0, writable: false });
                        if (kind === 'duplicate') yield ['scalarFirst', 3];
                        yield kind === 'change' ? ['scalarTail', 7] : tail;
                        return;
                    }
                    yield* Reflect.apply(iterator, this, []) as Iterable<unknown>;
                },
            });
            try {
                rememberMaterializedPersistenceFacts(entity, metadata, source, source);
            } catch (error) {
                failure = error;
            } finally {
                Object.defineProperty(Array.prototype, Symbol.iterator, iteratorDescriptor);
                if (tailDescriptor) Object.defineProperty(Object.prototype, 'scalarTail', tailDescriptor);
                else Reflect.deleteProperty(Object.prototype, 'scalarTail');
            }
            expect(intercepted).toBe(true);
            if (kind === 'readonly') {
                expect(failure).toBeInstanceOf(TypeError);
                expect(materializedPersistenceFacts(entity)).toBeUndefined();
                expect(reserveMaterializedEntity(entity)).toBe(false);
                rememberMaterializedPersistenceFacts({}, metadata, source, source);
                return;
            }
            expect(failure).toBeUndefined();
            const facts = requireDefined(materializedPersistenceFacts(entity));
            expect(facts.boundValues).toEqual(source);
            expect(facts.values).toEqual(kind === 'drop' ? { scalarFirst: 1 } : {
                scalarFirst: kind === 'duplicate' ? 3 : 1,
                scalarTail: kind === 'setter' ? 8 : kind === 'change' ? 7 : 2,
            });
            expect(Object.keys(facts.values)).toEqual(kind === 'drop' ? ['scalarFirst'] : kind === 'reverse' ? ['scalarTail', 'scalarFirst'] : ['scalarFirst', 'scalarTail']);
            expect(observed).toEqual(kind === 'setter' ? [{ keys: ['scalarFirst'], value: 2 }] : []);
        },
    );
});
