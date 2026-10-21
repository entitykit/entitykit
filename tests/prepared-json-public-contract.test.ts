import { captureMaterializedValues } from '../packages/core/src/materialization/materialized-value-capture';
import { entityReadMetadata } from './support/compiled-entity';

// These assertions also run against the original serializer, before specialization.
describe.each([false, true])('JSON encoder observations, compiled=%s', compiled => {
    function capture(value: unknown): ReturnType<typeof captureMaterializedValues> {
        return captureMaterializedValues(entityReadMetadata(compiled, undefined, 'json'), {
            id: 1, stored_value: value, tail: 2,
        });
    }

    it('keeps canonical key/scalar encoder calls and their changed results', () => {
        const events: unknown[] = [];
        const stringify = JSON.stringify;
        const spy = jest.spyOn(JSON, 'stringify').mockImplementation((value: unknown) => {
            events.push(value);
            return value === 7 ? '70' : stringify(value);
        });
        let result: ReturnType<typeof capture>;
        try {
            result = capture({ z: [7, null], a: true }); 
        } finally {
            spy.mockRestore(); 
        }
        expect(events).toEqual(['a', true, 'z', 7, null]);
        expect(result.boundValues.value).toBe('{"a":true,"z":[70,null]}');
        expect(result.values.value).toEqual({ z: [7, null], a: true });
    });

    it('finishes validation before encoding any output token', () => {
        const events: unknown[] = [];
        const stringify = JSON.stringify;
        const spy = jest.spyOn(JSON, 'stringify').mockImplementation((value: unknown) => {
            events.push(value);
            return stringify(value);
        });
        try {
            expect(() => capture({ a: 1, z: { invalid: NaN } }))
                .toThrow('\'PlannedRow.value.z.invalid\' (NaN)');
        } finally {
            spy.mockRestore(); 
        }
        expect(events).toEqual([]);
    });

    it('encodes an alias again while keeping its captured data independent', () => {
        const shared = { n: 7 };
        const source = { a: shared, b: shared };
        const stringify = JSON.stringify;
        let visits = 0;
        const spy = jest.spyOn(JSON, 'stringify').mockImplementation((value: unknown) => {
            if (value === 7) {
                visits++;
                shared.n = 99;
                return String(visits);
            }
            return stringify(value);
        });
        let result: ReturnType<typeof capture>;
        try {
            result = capture(source); 
        } finally {
            spy.mockRestore(); 
        }
        expect(visits).toBe(2);
        expect(result.boundValues.value).toBe('{"a":{"n":1},"b":{"n":2}}');
        expect(result.values.value).toEqual({ a: { n: 7 }, b: { n: 7 } });
        expect(shared.n).toBe(99);
    });
});
