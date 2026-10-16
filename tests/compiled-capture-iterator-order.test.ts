import { captureMaterializedValues } from '../packages/core/src/materialization/materialized-value-capture';
import { compiledEntityPlan } from '../packages/core/src/materialization/compiled-entity-plan';
import { entityReadMetadata } from './support/compiled-entity';

it('captures reordered, replaced and repeated iterator fields in pull order', () => {
    const metadata = entityReadMetadata(), plan = compiledEntityPlan(metadata);
    if (!plan) throw new Error('Expected compiled plan.');
    const alternate = { ...plan[2], name: 'alternate', property: { ...plan[2].property, columnName: 'other' } };
    const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);
    if (!descriptor) throw new Error('Missing array iterator.');
    const original = Array.prototype[Symbol.iterator], events: string[] = [];
    let reads = 0, result;
    try {
        Object.defineProperty(Array.prototype, Symbol.iterator, { ...descriptor, value: function* (this: unknown[]) {
            if (this === plan) {
                events.push('next:value'); yield plan[1];
                events.push('next:id'); yield plan[0];
                events.push('next:alternate'); yield alternate;
                events.push('next:value-again'); yield plan[1];
                events.push('done');
            } else {
                yield* Reflect.apply(original, this, []) as Iterable<unknown>;
            }
        } });
        result = captureMaterializedValues(metadata, { id: 1, stored_value: 'value', tail: 2, other: 9 }, {
            readValue(value, type): unknown {
                events.push(`read:${type}`);
                return type === 'text' ? `value-${String(++reads)}` : value;
            },
        });
    } finally {
        Object.defineProperty(Array.prototype, Symbol.iterator, descriptor);
    }
    expect(result).toEqual({
        values: { value: 'value-2', id: 1, alternate: 9 },
        boundValues: { value: 'value-2', id: 1, alternate: 9 },
    });
    expect(Object.keys(result.values)).toEqual(['value', 'id', 'alternate']);
    expect(events).toEqual([
        'next:value', 'read:text', 'next:id', 'read:integer',
        'next:alternate', 'read:integer', 'next:value-again', 'read:text', 'done',
    ]);
});
