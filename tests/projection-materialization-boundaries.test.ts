import { materializeProjectionRows } from '../packages/core/src/core/projection-row-materializer';
import { createQueryModel } from '../packages/core/src/query/query-model';
import type { ProjectionComputedExpression } from '../packages/core/src/query/projection';

function computed(
    materialization: ProjectionComputedExpression['materialization'],
): ProjectionComputedExpression {
    return {
        kind: 'computed', alias: 'value', expression: { kind: 'literal', value: 0 },
        materialization,
    };
}

describe('projection materialization boundaries', () => {
    it('returns separate empty plain records without a projection', () => {
        const read = jest.fn();
        const results = materializeProjectionRows(createQueryModel(class Row {}), [{}, {}], read);
        expect(results).toEqual([{}, {}]);
        expect(results.map(Object.keys)).toEqual([[], []]);
        expect(results[0]).not.toBe(results[1]);
        expect(Object.getPrototypeOf(results[0])).toBe(Object.prototype);
        expect(read).not.toHaveBeenCalled();
    });

    it.each([{ value: null }, { value: undefined }])('preserves computed nullish values: $value', ({ value }) => {
        const read = jest.fn();
        for (const kind of ['number', 'field'] as const) {
            const model = { ...createQueryModel(class Row {}), projection: [computed({ kind })] };
            expect(materializeProjectionRows(model, [{ value }], read)).toEqual([{ value }]);
        }
        expect(read).not.toHaveBeenCalled();
    });

    it('normalizes numeric strings while retaining raw computed values', () => {
        const read = jest.fn();
        const base = createQueryModel(class Row {});
        const numeric = { ...base, projection: [computed({ kind: 'number' })] };
        const raw = { ...base, projection: [computed({ kind: 'raw' })] };
        expect(materializeProjectionRows(numeric, [{ value: '7.5' }], read)).toEqual([{ value: 7.5 }]);
        expect(materializeProjectionRows(raw, [{ value: '7.5' }], read)).toEqual([{ value: '7.5' }]);
        expect(read).not.toHaveBeenCalled();
    });

    it('refuses a non-null computed field without materialization metadata', () => {
        const model = {
            ...createQueryModel(class Row {}), projection: [computed({ kind: 'field' })],
        };
        const read = jest.fn();
        expect(() => materializeProjectionRows(model, [{ value: 1 }], read))
            .toThrow('Computed projection \'value\' has no materialization property.');
        expect(read).not.toHaveBeenCalled();
    });

    it('replaces a primitive ancestor with an owned nested object', () => {
        const model = {
            ...createQueryModel(class Row {}),
            projection: [
                { kind: 'field' as const, alias: 'scope', propertyName: 'scope' },
                { kind: 'field' as const, alias: 'next', propertyName: 'next', path: ['scope', 'value'] },
            ],
        };
        const row = { scope: 1, next: 42 };
        expect(materializeProjectionRows(model, [row], (_source, _property, value) => value))
            .toEqual([{ scope: { value: 42 } }]);
        expect(row).toEqual({ scope: 1, next: 42 });
    });
});
