import { captureMaterializedValues } from '../packages/core/src/materialization/materialized-value-capture';
import { EntityMetadata } from '../packages/core/src/model/entity-metadata';
import {
    fromBoundPropertyValue, fromProviderValue, providerValueFromBoundProperty,
    toBoundProviderValue, toProviderValue, toStoreValue,
} from '../packages/core/src/model/value-converter/store-value';

class CaptureRow {
    public value: unknown = undefined;
}

function fixture(columnType = 'text'): EntityMetadata<CaptureRow> {
    return new EntityMetadata({
        ctor: CaptureRow, tableName: 'rows', isKeyless: true,
        properties: [{
            propertyName: 'value', propertyPath: ['value'], columnName: 'value',
            columnType, isRequired: false, isPrimaryKey: false,
            isUnique: false, isConcurrencyToken: false, isVersion: false,
        }],
    });
}

describe('materialized capture diagnostic observations', () => {
    it('preserves metadata and provider-read order with live output keys', () => {
        const metadata = fixture();
        const events: string[] = [];
        let names = 0;
        Object.defineProperty(metadata, 'entityName', { get: () => {
            events.push('entity');
            return 'Original';
        } });
        Object.defineProperties(metadata.properties[0], {
            propertyName: { get: () => {
                events.push('name');
                return ++names === 1 ? 'diagnostic' : 'output';
            } },
            columnName: { get: () => {
                events.push('column'); return 'value';
            } },
            columnType: { get: () => {
                events.push('type'); return 'text';
            } },
            converter: { get: () => {
                events.push('converter'); return undefined;
            } },
        });
        const captured = captureMaterializedValues(metadata, { get value() {
            events.push('row');
            return 'raw';
        } }, { readValue: (value, type) => {
            expect([value, type]).toEqual(['raw', 'text']);
            events.push('reader');
            return 'normalized';
        } });
        expect(captured).toEqual({
            values: { output: 'normalized' }, boundValues: { output: 'normalized' },
        });
        expect(events).toEqual([
            'entity', 'name', 'column', 'row', 'type', 'reader',
            'name', 'converter', 'name', 'type',
        ]);
    });

    it.each([null, undefined])('observes names and metadata while bypassing converters for %p', value => {
        const metadata = fixture();
        const events: string[] = [];
        const fromProvider = jest.fn();
        Object.defineProperty(metadata, 'entityName', { get: () => {
            events.push('entity');
            return 'Original';
        } });
        Object.defineProperties(metadata.properties[0], {
            propertyName: { get: () => {
                events.push('name'); return 'value';
            } },
            columnType: { get: () => {
                events.push('type'); return 'text';
            } },
            converter: { get: () => {
                events.push('converter'); return { fromProvider };
            } },
        });
        const readValue = jest.fn();
        expect(captureMaterializedValues(metadata, { value }, { readValue }))
            .toEqual({ values: { value }, boundValues: { value } });
        expect(readValue).not.toHaveBeenCalled();
        expect(fromProvider).not.toHaveBeenCalled();
        expect(events).toEqual(['entity', 'name', 'name', 'converter', 'name', 'type']);
    });

    it('coerces a live entity name before observing the property name', () => {
        const metadata = fixture();
        const events: string[] = [];
        Object.defineProperty(metadata, 'entityName', { get: () => ({ toString: () => {
            events.push('coerce entity');
            return 'Original';
        } }) });
        Object.defineProperty(metadata.properties[0], 'propertyName', { get: () => {
            events.push('name');
            return 'value';
        } });
        captureMaterializedValues(metadata, { value: 'after' });
        expect(events).toEqual(['coerce entity', 'name', 'name', 'name']);
    });

    it('reports converter failures with names captured before provider normalization', () => {
        const metadata = fixture();
        let name = 'Original';
        Object.defineProperty(metadata, 'entityName', { get: () => name });
        const converter = { fromProvider(value: unknown) {
            expect(this).toBe(converter);
            expect(value).toBe('normalized');
            return { then: (): void => undefined };
        } };
        Object.defineProperty(metadata.properties[0], 'converter', { value: converter });
        expect(() => captureMaterializedValues(metadata, { value: 'raw' }, { readValue: () => {
            name = 'AfterRead';
            return 'normalized';
        } })).toThrow('Value converter for \'Original.value\' fromProvider() must be synchronous');
    });

    it.each(['date', 'json'])('retains original diagnostic names for invalid %s provider facts', kind => {
        const metadata = fixture(kind === 'date' ? 'timestamp' : 'json');
        let name = 'Original';
        Object.defineProperty(metadata, 'entityName', { get: () => name });
        expect(() => captureMaterializedValues(metadata, { get value() {
            name = 'AfterRow';
            return kind === 'date' ? new Date(Number.NaN) : 1n;
        } })).toThrow(kind === 'date'
            ? 'Invalid Date at \'Original.value\''
            : 'Unsupported JSON value at \'Original.value\' (bigint)');
    });

    it.each(['', 'value'])('keeps the diagnostic separator with empty entity names and property %p', name => {
        const metadata = fixture('json');
        Object.defineProperty(metadata, 'entityName', { value: '' });
        Object.defineProperty(metadata.properties[0], 'propertyName', { value: name });
        expect(() => captureMaterializedValues(metadata, { value: 1n }))
            .toThrow(`Unsupported JSON value at '.${name}' (bigint)`);
    });

    it('keeps model and bound facts independent through structured conversion', () => {
        const metadata = fixture('json');
        const input = { tags: ['a'] };
        Object.defineProperty(metadata.properties[0], 'converter', { value: {
            fromProvider: (value: { tags: string[] }) => {
                value.tags.push('model');
                return value;
            },
        } });
        const result = captureMaterializedValues(metadata, { value: input });
        expect(result.values).toEqual({ value: { tags: ['a', 'model'] } });
        expect(result.boundValues).toEqual({ value: '{"tags":["a"]}' });
        expect(input).toEqual({ tags: ['a'] });
    });

    it('observes a failing name getter before a row getter', () => {
        const metadata = fixture();
        Object.defineProperty(metadata, 'entityName', { get: () => {
            throw new Error('name failed');
        } });
        const read = jest.fn(() => 'raw');
        const row = Object.defineProperty({}, 'value', { get: read });
        expect(() => captureMaterializedValues(metadata, row)).toThrow('name failed');
        expect(read).not.toHaveBeenCalled();
    });

    it('preserves existing complete-context and default-context helper calls', () => {
        expect(() => toBoundProviderValue(new Date(Number.NaN), 'timestamp'))
            .toThrow('Invalid Date at \'mapped property\'');
        expect(() => toBoundProviderValue(1n, 'json', 'Complete.field')).toThrow('Complete.field');
        expect(() => fromProviderValue<unknown>('raw', {
            toProvider: value => value,
            fromProvider: () => ({ then: (): void => undefined }),
        })).toThrow('ValueConverter.fromProvider() must be synchronous');
    });

    it.each([null, undefined])('bypasses model conversion for %p', value => {
        const toProvider = jest.fn(() => {
            throw new Error('must not convert');
        });
        expect(toProviderValue(value, { toProvider, fromProvider: input => input })).toBe(value);
        expect(toProvider).not.toHaveBeenCalled();
    });

    it('retains the default JSON context when binding a model value', () => {
        expect(() => toStoreValue(1n, 'json')).toThrow('Unsupported JSON value at \'mapped JSON property\'');
    });

    it.each([' JSON ', ' JSONB '])('round trips normalized %p columns before conversion', columnType => {
        const property = fixture(columnType).properties[0];
        const model = { tags: ['a', 'b'] };
        const bound = toBoundProviderValue(model, columnType);
        expect(bound).toBe('{"tags":["a","b"]}');
        const fromProvider = jest.fn((value: unknown) => ({ wrapped: value }));
        Object.defineProperty(property, 'converter', { value: {
            fromProvider, toProvider: (value: unknown) => value,
        } });
        expect(fromBoundPropertyValue(bound, property, 'CaptureRow')).toEqual({ wrapped: model });
        expect(fromProvider).toHaveBeenCalledTimes(1);
        expect(fromProvider).toHaveBeenCalledWith(model);
        expect(fromProvider.mock.calls[0][0]).not.toBe(model);
    });

    it.each([null, undefined, 42, { tags: ['a'] }])('preserves a non-string JSON fact %p', value => {
        expect(providerValueFromBoundProperty(value, fixture('json').properties[0])).toBe(value);
    });

    it('leaves JSON-looking text unchanged', () => {
        expect(providerValueFromBoundProperty('{"value":1}', fixture('text').properties[0]))
            .toBe('{"value":1}');
    });

    it.each(['CaptureRow', ''])('reports bound conversion failures for entity %p', entityName => {
        const property = fixture('json').properties[0];
        Object.defineProperty(property, 'converter', { value: {
            fromProvider: () => ({ then: (): void => undefined }),
        } });
        expect(() => fromBoundPropertyValue('{}', property, entityName)).toThrow(
            `Value converter for '${entityName ? `${entityName}.` : ''}value' fromProvider() must be synchronous`,
        );
    });
});
