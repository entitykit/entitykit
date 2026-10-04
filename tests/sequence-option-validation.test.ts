import { ModelBuilder } from '../packages/core/src/model/model-builder';
import type { SequenceBuilder } from '../packages/core/src/model/sequence-builder-types';
import { requireDefined } from './support/require-defined';

function configured(configure?: (sequence: SequenceBuilder) => void): ModelBuilder {
    return new ModelBuilder().hasSequence('book_numbers', configure);
}

describe('sequence option boundaries', () => {
    it.each([
        ['startsAt', 'Sequence start value'], ['incrementsBy', 'Sequence increment'],
        ['hasMin', 'Sequence minimum'], ['hasMax', 'Sequence maximum'],
    ] as const)(
        'refuses unsafe %s numeric values', (method, label) => {
            for (const value of [0.5, Infinity, -Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
                expect(() => configured(sequence => {
                    sequence[method](value);
                }))
                    .toThrow(`${label} must be a safe integer or bigint.`);
            }
        },
    );

    it.each([0, 0n])('refuses a zero sequence increment %p', value => {
        expect(() => configured(sequence => sequence.incrementsBy(value)))
            .toThrow('Sequence increment must not be zero');
    });

    it.each([0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('refuses invalid cache %p', value => {
        expect(() => configured(sequence => sequence.hasCache(value)))
            .toThrow('Sequence cache must be a positive safe integer');
    });

    it.each([
        [2, 1], [0, 0], [2n, 1n], [0n, 0n],
    ] as const)('refuses non-increasing sequence bounds %p..%p', (minimum, maximum) => {
        expect(() => configured(sequence => sequence.hasMin(minimum).hasMax(maximum)).build())
            .toThrow('Sequence minimum must be less than its maximum');
    });

    it.each([
        [0, 1, 2, 'below its minimum'], [3, 1, 2, 'exceed its maximum'],
        [0n, 1n, 2n, 'below its minimum'], [3n, 1n, 2n, 'exceed its maximum'],
    ] as const)('refuses start %p outside %p..%p', (start, minimum, maximum, message) => {
        expect(() => configured(sequence => sequence.startsAt(start).hasMin(minimum).hasMax(maximum)).build())
            .toThrow(message);
    });

    it.each([0, 1, 0n, 1n])('retains inclusive endpoint %p with descending increments', start => {
        const metadata = requireDefined(configured(sequence => sequence
            .hasSchema(' catalog ').hasDataType('integer').startsAt(start)
            .hasMin(0).hasMax(1).incrementsBy(-1).hasCache(1).isCyclic(false))
            .build().toSnapshot().sequences?.[0]);
        expect(metadata).toEqual({
            name: 'book_numbers', schemaName: ' catalog ', dataType: 'integer',
            startValue: String(start), minValue: '0', maxValue: '1',
            incrementBy: '-1', cache: 1, isCyclic: false,
        });
    });

    it('retains defaults, explicit cycling and exact bigint options', () => {
        expect(configured().build().toSnapshot().sequences?.[0])
            .toMatchObject({ name: 'book_numbers', isCyclic: false });
        expect(configured(sequence => sequence.startsAt(9_007_199_254_740_993n)
            .hasMax(9_007_199_254_740_994n).isCyclic()).build().toSnapshot().sequences?.[0])
            .toMatchObject({ startValue: '9007199254740993', maxValue: '9007199254740994', isCyclic: true });
    });
});
