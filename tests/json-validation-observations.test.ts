import { captureMaterializedValues } from '../packages/core/src/materialization/materialized-value-capture';
import { entityReadMetadata } from './support/compiled-entity';

function observeCapture(compiled: boolean, source: unknown, reject?: number, throwAt?: number): {
    events: string[];
    captured: ReturnType<typeof captureMaterializedValues> | undefined;
    failure: unknown;
} {
    const metadata = entityReadMetadata(compiled, undefined, 'json');
    const events: string[] = [];
    const finite = Number.isFinite, stringify = JSON.stringify;
    const validation = jest.spyOn(Number, 'isFinite').mockImplementation(value => {
        events.push(`validate ${String(value)}`);
        if (value === throwAt) throw new Error('validator failed');
        return value !== reject && finite(value);
    });
    const encoder = jest.spyOn(JSON, 'stringify').mockImplementation((value: unknown) => {
        events.push(`encode ${String(value)}`);
        return stringify(value);
    });
    let captured: ReturnType<typeof captureMaterializedValues> | undefined;
    let failure: unknown;
    try {
        captured = captureMaterializedValues(metadata, { id: 1, stored_value: source, tail: 2 });
    } catch (error) {
        failure = error;
    } finally {
        validation.mockRestore();
        encoder.mockRestore();
    }
    return { events, captured, failure };
}

describe.each([false, true])('JSON validation observations, compiled=%s', compiled => {
    it('validates aliases once, in sorted path order, before emitting any values', () => {
        const shared = { v: 303 }, source = { z: shared, 'b-c': 202, a: [101, shared] };
        const result = observeCapture(compiled, source);

        expect(result.failure).toBeUndefined();
        expect(result.events).toEqual([
            'validate 101', 'validate 303', 'encode b-c', 'validate 202',
            'encode a', 'encode 101', 'encode v', 'encode 303',
            'encode b-c', 'encode 202', 'encode z', 'encode v', 'encode 303',
        ]);
        expect(result.captured?.boundValues.value).toBe('{"a":[101,{"v":303}],"b-c":202,"z":{"v":303}}');
        const snapshot = result.captured?.values.value as typeof source;
        expect(snapshot).toEqual(source);
        expect(snapshot.z).toBe(snapshot.a[1]);
        expect(snapshot.z).not.toBe(shared);
    });

    it.each([
        { rejected: 101, path: 'a[0]' },
        { rejected: 303, path: 'a[1].v' },
        { rejected: 202, path: '["b-c"]' },
    ])('reports the complete property path for $rejected and finishes validation', ({ rejected, path }) => {
        const shared = { v: 303 };
        const result = observeCapture(compiled, { z: shared, 'b-c': 202, a: [101, shared] }, rejected);

        expect(result.captured).toBeUndefined();
        expect(result.failure).toBeInstanceOf(TypeError);
        const suffix = path.startsWith('[') ? path : `.${path}`;
        expect((result.failure as Error).message).toBe(
            `Unsupported JSON value at 'PlannedRow.value${suffix}' (${String(rejected)}). ` +
            'JSON properties must contain synchronous JSON-compatible values.',
        );
        expect(result.events).toEqual(['validate 101', 'validate 303', 'encode b-c', 'validate 202']);
    });

    it('preserves the first invalid path while visiting later invalid values', () => {
        // The repeated invalid value in the array comes first in canonical key order.
        const result = observeCapture(compiled, { z: 101, a: [101, 202], 'b-c': 101 }, 101);

        expect(result.captured).toBeUndefined();
        expect((result.failure as Error).message).toBe(
            'Unsupported JSON value at \'PlannedRow.value.a[0]\' (101). ' +
            'JSON properties must contain synchronous JSON-compatible values.',
        );
        expect(result.events).toEqual(['validate 101', 'validate 202', 'encode b-c', 'validate 101', 'validate 101']);
    });

    it('propagates a validation callback failure before emission or later traversal', () => {
        const result = observeCapture(compiled, { z: 303, a: [101, 202] }, undefined, 202);

        expect(result.captured).toBeUndefined();
        expect((result.failure as Error).message).toBe('validator failed');
        expect(result.events).toEqual(['validate 101', 'validate 202']);
    });

    it('does not send nonnumeric JSON leaves to the finite-number check', () => {
        const source = { leaves: [null, true, false, 'text', 101] };
        const result = observeCapture(compiled, source);

        expect(result.failure).toBeUndefined();
        expect(result.events).toEqual([
            'validate 101', 'encode leaves', 'encode null', 'encode true',
            'encode false', 'encode text', 'encode 101',
        ]);
        expect(result.captured?.boundValues.value).toBe('{"leaves":[null,true,false,"text",101]}');
    });
});
