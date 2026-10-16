import { captureMaterializedValues } from '../packages/core/src/materialization/materialized-value-capture';
import { entityReadMetadata } from './support/compiled-entity';

describe.each([false, true])('binding mapping switches, compiled=%s', compiled => {
    it('keeps per-mapping binding and per-row ownership across repeated switches', () => {
        const kinds = ['text', 'jsonb', ' JSON ', 'json'];
        const mappings = kinds.map(kind => entityReadMetadata(compiled, undefined, kind));
        for (const index of [1, 0, 3, 2, 0, 1]) {
            const metadata = mappings[index];
            for (const value of [null, 'value', { nested: [1] }]) {
                const capture = captureMaterializedValues(metadata, { id: 1, stored_value: value, tail: 2 });
                expect(capture.values.value).toEqual(value);
                expect(capture.boundValues.value).toEqual(value === null || kinds[index] === 'text'
                    ? value : JSON.stringify(value));
                if (value !== null && typeof value === 'object') {
                    expect(capture.values.value).not.toBe(value);
                    value.nested.push(2);
                    expect(capture.values.value).toEqual({ nested: [1] });
                    expect(capture.boundValues.value).toEqual(kinds[index] === 'text'
                        ? { nested: [1] } : '{"nested":[1]}');
                }
            }
        }
    });

    it('keeps the outer binding when a reader captures a different mapping', () => {
        const json = entityReadMetadata(compiled, undefined, 'jsonb');
        const scalar = entityReadMetadata(compiled);
        const events: string[] = [];
        const source = { get n(): number {
            events.push('source');return events.filter(event => event === 'source').length;
        } };
        const reader = { readValue(value: unknown, columnType: string): unknown {
            events.push(columnType);
            if (columnType === 'jsonb') {
                const nested = captureMaterializedValues(scalar, { id: 2, stored_value: { n: 9 }, tail: 3 });
                expect(nested.boundValues.value).toEqual({ n: 9 });
            }
            return value;
        } };
        const capture = captureMaterializedValues(json, { id: 1, stored_value: source, tail: 2 }, reader);
        expect(events).toEqual(['integer', 'jsonb', 'source', 'source', 'integer']);
        expect(capture.values.value).toEqual({ n: 1 });
        expect(capture.boundValues.value).toBe('{"n":2}');
    });
});
