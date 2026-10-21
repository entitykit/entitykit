import type { PropertyMetadata } from '../packages/core/src/model/property-metadata';
import { valueConverter } from '../packages/core/src';
import { writeVerifiedProperty } from '../packages/core/src/verified-property-write';

const property: PropertyMetadata = {
    propertyName: 'value', propertyPath: ['value'], columnName: 'value', columnType: 'text',
    isRequired: false, isPrimaryKey: false, isUnique: false,
    isConcurrencyToken: false, isVersion: false,
};

describe('verified primitive assignments', () => {
    it.each([
        undefined, null, false, true, 0, -0, NaN, 1n, Symbol('value'), '',
    ])('preserves the exact assigned primitive: %s', value => {
        const row: { value: unknown } = { value: 'before' };
        const actual = writeVerifiedProperty(row, property, value, 'Row.value');
        expect(Object.is(actual, value)).toBe(true);
        expect(Object.is(row.value, value)).toBe(true);
    });

    it('rejects normalization of negative zero without a converter', () => {
        const row = {
            get value(): number {
                return 0;
            },
            set value(value: number) { /* Refuse negative zero. */ },
        };
        expect(() => writeVerifiedProperty(row, property, -0, 'Row.value'))
            .toThrow('refused its assigned value');
    });

    it('retains the comparison policy captured before the setter runs', () => {
        const mutable = { ...property };
        const trimming = valueConverter<string, string>({
            toProvider: value => value.trim(), fromProvider: value => value,
        });
        let stored = '';
        const row = {
            get value(): string {
                return stored;
            },
            set value(value: string) {
                Object.defineProperty(mutable, 'converter', { value: trimming });
                stored = value.trim();
            },
        };
        expect(() => writeVerifiedProperty(row, mutable, ' padded ', 'Row.value'))
            .toThrow('refused its assigned value');
        expect(stored).toBe('padded');
    });
});
