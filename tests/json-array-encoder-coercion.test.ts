import { captureMaterializedValues } from '../packages/core/src/materialization/materialized-value-capture';
import { entityReadMetadata } from './support/compiled-entity';

interface EncoderCase {
    readonly name: string;
    readonly result?: string;
    readonly error?: 'symbol' | 'custom';
    readonly coercions: readonly string[];
    readonly encoded: (events: string[]) => unknown;
}

const cases: readonly EncoderCase[] = [
    {
        name: 'string hint', result: '[11,2,3]', coercions: ['hint string'],
        encoded: events => ({ [Symbol.toPrimitive](hint: string): string {
            events.push(`hint ${hint}`);
            return hint === 'string' ? '11' : '99';
        } }),
    },
    {
        name: 'toString before valueOf', result: '[11,2,3]', coercions: ['toString'],
        encoded: events => ({
            valueOf(): string {
                events.push('valueOf');return '99';
            },
            toString(): string {
                events.push('toString');return '11';
            },
        }),
    },
    { name: 'null return', result: '[,2,3]', coercions: [], encoded: () => null },
    { name: 'undefined return', result: '[,2,3]', coercions: [], encoded: () => undefined },
    { name: 'Symbol return', error: 'symbol', coercions: [], encoded: () => Symbol('encoded') },
    {
        name: 'Symbol coercion result', error: 'symbol', coercions: ['hint string'],
        encoded: events => ({ [Symbol.toPrimitive](hint: string): symbol {
            events.push(`hint ${hint}`);
            return Symbol('encoded');
        } }),
    },
    {
        name: 'coercion failure', error: 'custom', coercions: ['hint string'],
        encoded: events => ({ [Symbol.toPrimitive](hint: string): never {
            events.push(`hint ${hint}`);
            throw new Error('encoder coercion failed');
        } }),
    },
];

describe.each([false, true])('array encoder coercion, compiled=%s', compiled => {
    it.each(cases)('preserves $name after encoding every child', testCase => {
        const metadata = entityReadMetadata(compiled, undefined, 'json');
        const source = [1, 2, 3], events: string[] = [];
        const stringify = JSON.stringify;
        const spy = jest.spyOn(JSON, 'stringify').mockImplementation((value: unknown) => {
            events.push(`encode ${String(value)}`);
            return value === 1 ? testCase.encoded(events) as string : stringify(value);
        });
        let captured: ReturnType<typeof captureMaterializedValues> | undefined;
        let failure: unknown;
        try {
            captured = captureMaterializedValues(metadata, { id: 1, stored_value: source, tail: 2 });
        } catch (error) {
            failure = error;
        } finally {
            spy.mockRestore();
        }
        expect(events).toEqual(['encode 1', 'encode 2', 'encode 3', ...testCase.coercions]);
        if (testCase.error) {
            expect(captured).toBeUndefined();
            expect(failure).toBeInstanceOf(testCase.error === 'symbol' ? TypeError : Error);
            if (testCase.error === 'custom') expect((failure as Error).message).toBe('encoder coercion failed');
        } else {
            expect(failure).toBeUndefined();
            expect(captured?.boundValues.value).toBe(testCase.result);
            expect(captured?.values.value).toEqual(source);
            expect(captured?.values.value).not.toBe(source);
        }
    });
});
