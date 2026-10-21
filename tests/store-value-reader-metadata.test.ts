import { readStoreValue } from '../packages/core/src/storage/store-value-reader';

describe('store value read metadata observation', () => {
    it.each([null, undefined, false, 0, ''])('preserves normalization and metadata reads without converter %p', converter => {
        const events: string[] = [];
        const property = {
            get columnType(): string {
                events.push('type');
                return 'text';
            },
            get propertyName(): string {
                events.push('name');
                return 'value';
            },
            get converter(): unknown {
                events.push('converter');
                return converter;
            },
        };
        const reader = {
            readValue: (value: unknown, columnType: string): unknown => {
                events.push(`read:${columnType}`);
                return value;
            },
        };
        const value = { nested: ['value'] };

        expect(readStoreValue(value, property, reader, 'Record')).toBe(value);
        expect(events).toEqual(['type', 'read:text', 'name', 'name', 'converter']);
    });

    it.each([null, undefined])('observes metadata but bypasses callbacks for %p', value => {
        const events: string[] = [];
        const property = {
            get columnType(): string {
                throw new Error('column type should not be read');
            },
            get propertyName(): undefined {
                events.push('name');
                return undefined;
            },
            get converter(): unknown {
                events.push('converter');
                return { fromProvider: (): never => {
                    throw new Error('converter called');
                } };
            },
        };
        const reader = { readValue: (): never => {
            throw new Error('reader called');
        } };

        expect(readStoreValue(value, property, reader, 'Record')).toBe(value);
        expect(events).toEqual(['name', 'converter']);
    });

    it('uses metadata changed by normalization and binds the converter receiver', () => {
        const events: string[] = [];
        const property = { columnType: 'text', propertyName: 'before', converter: {} };
        const converter = {
            fromProvider(value: unknown): unknown {
                expect(this).toBe(converter);
                events.push('convert');
                return { normalized: value };
            },
        };
        const reader = {
            readValue: (): string => {
                events.push('read');
                property.propertyName = 'after';
                property.converter = converter;
                return 'normalized';
            },
        };

        expect(readStoreValue('raw', property, reader, 'Record')).toEqual({ normalized: 'normalized' });
        expect(events).toEqual(['read', 'convert']);
    });

    it.each([
        { names: ['before', 'after'], entity: 'Record', label: 'Value converter for \'Record.after\' fromProvider()' },
        { names: ['before', undefined], entity: 'Record', label: 'Value converter for \'Record.undefined\' fromProvider()' },
        { names: ['before', 'after'], entity: undefined, label: 'Value converter for \'after\' fromProvider()' },
        { names: [undefined], entity: 'Record', label: 'ValueConverter.fromProvider()' },
        { names: ['', ''], entity: '', label: 'ValueConverter.fromProvider()' },
    ])('preserves diagnostic context $label', ({ names, entity, label }) => {
        const events: string[] = [];
        let index = 0;
        const property = {
            columnType: 'text',
            get propertyName(): string | undefined {
                events.push('name');
                return names[index++];
            },
            get converter(): unknown {
                events.push('converter');
                return { fromProvider: (): unknown => ({ then: (): void => undefined }) };
            },
        };

        expect(() => readStoreValue('value', property, undefined, entity)).toThrow(`${label} must be synchronous`);
        expect(events).toEqual([...names.map(() => 'name'), 'converter']);
    });

    it('still observes a throwing metadata getter on a nullish value', () => {
        const property = {
            columnType: 'text',
            get propertyName(): string {
                throw new Error('metadata failed');
            },
        };

        expect(() => readStoreValue(null, property)).toThrow('metadata failed');
    });
});
