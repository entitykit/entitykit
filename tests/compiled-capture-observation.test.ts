import { captureMaterializedValues } from '../packages/core/src/materialization/materialized-value-capture';
import { compiledEntityPlan } from '../packages/core/src/materialization/compiled-entity-plan';
import * as writes from '../packages/core/src/tracking/write-snapshot-value';
import { entityReadMetadata } from './support/compiled-entity';

describe('compiled capture observation boundaries', () => {
    it('honors a truncated mapping iterator', () => {
        const metadata = entityReadMetadata(), plan = compiledEntityPlan(metadata);
        if (!plan) throw new Error('Expected compiled plan.');
        const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);
        if (!descriptor) throw new Error('Missing array iterator.');
        const original = Array.prototype[Symbol.iterator];
        let iterations = 0, result;
        try {
            Object.defineProperty(Array.prototype, Symbol.iterator, { ...descriptor, value: function* (this: unknown[]) {
                if (this === plan) {
                    iterations++; yield plan[0];
                } else {
                    yield* Reflect.apply(original, this, []) as Iterable<unknown>;
                }
            } });
            result = captureMaterializedValues(metadata, { id: 1, stored_value: 'value', tail: 2 });
        } finally {
            Object.defineProperty(Array.prototype, Symbol.iterator, descriptor);
        }
        expect(result).toEqual({ values: { id: 1 }, boundValues: { id: 1 } });
        expect(iterations).toBe(1);
    });

    it('closes the mapping iterator when a reader fails', () => {
        const metadata = entityReadMetadata(), plan = compiledEntityPlan(metadata);
        if (!plan) throw new Error('Expected compiled plan.');
        const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);
        if (!descriptor) throw new Error('Missing array iterator.');
        const original = Array.prototype[Symbol.iterator];
        let closed = false, failure: unknown;
        const expected = new Error('reader failed');
        try {
            Object.defineProperty(Array.prototype, Symbol.iterator, { ...descriptor, value: function* (this: unknown[]) {
                if (this === plan) {
                    try {
                        yield plan[0]; yield plan[1];
                    } finally {
                        closed = true;
                    }
                } else {
                    yield* Reflect.apply(original, this, []) as Iterable<unknown>;
                }
            } });
            try {
                captureMaterializedValues(metadata, { id: 1 }, { readValue(): never {
                    throw expected;
                } });
            } catch (error) {
                failure = error;
            }
        } finally {
            Object.defineProperty(Array.prototype, Symbol.iterator, descriptor);
        }
        expect(failure).toBe(expected);
        expect(closed).toBe(true);
    });

    it('keeps ordinary root-write helpers live after reader callbacks', () => {
        const metadata = entityReadMetadata(), original = writes.writeSnapshotValue;
        let restore: (() => void) | undefined, result;
        const receivers: unknown[] = [];
        try {
            result = captureMaterializedValues(metadata, { id: 1, stored_value: 'value', tail: 2 }, {
                readValue(value, type): unknown {
                    if (type === 'text') {
                        const spy = jest.spyOn(writes, 'writeSnapshotValue').mockImplementation(function (this: unknown, target, key, item) {
                            receivers.push(this);
                            original(target, `observed_${key}`, item);
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
        expect(result).toEqual({
            values: { id: 1, observed_value: 'value', observed_tail: 2 },
            boundValues: { id: 1, observed_value: 'value', observed_tail: 2 },
        });
        expect(receivers).toEqual([undefined, undefined, undefined, undefined]);
    });
});
