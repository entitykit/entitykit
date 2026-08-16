import { valueConverter } from '../src';
import { ModelBuilder } from '../src/model/model-builder';
import type { PropertyMetadata } from '../src/model/property-metadata';
import { writeVerifiedProperty } from '../src/verified-property-write';

function defineAccessor(
    row: object,
    name: string,
    store: (value: unknown) => unknown,
): void {
    let stored: unknown;
    Object.defineProperty(row, name, {
        configurable: true,
        get: () => stored,
        set: (value: unknown) => {
            stored = store(value);
        },
    });
}

class StrongId {
    readonly #value: string;

    constructor(value: string) {
        this.#value = value;
    }

    public get value(): string {
        return this.#value;
    }
}

class HiddenId {
    constructor(value: string) {
        Object.defineProperty(this, 'value', {
            configurable: true, enumerable: false, value,
        });
    }

    public get text(): string {
        return Reflect.get(this, 'value') as string;
    }
}

let strongConversions = 0;
const strongIdConverter = valueConverter<StrongId, string>({
    toProvider: value => {
        strongConversions += 1;
        if (!(value instanceof StrongId)) {
            throw new TypeError('unconvertible strong identifier');
        }
        return value.value;
    },
    fromProvider: value => new StrongId(value),
});

const hiddenIdConverter = valueConverter<HiddenId, string>({
    toProvider: value => value.text,
    fromProvider: value => new HiddenId(value),
});

let textConversions = 0;
const countedTrimming = valueConverter<string, string>({
    toProvider: value => {
        textConversions += 1;
        return value.trim();
    },
    fromProvider: value => value,
});

const joinedParts = valueConverter<{ parts: string[] }, string>({
    toProvider: value => value.parts.join('|'),
    fromProvider: value => ({ parts: value.split('|') }),
});

class ConvertedRow {
    public strong = new StrongId('seed');
    public hidden = new HiddenId('seed');
    public text = 'seed';
    public parts: { parts: string[] } = { parts: [] };
}

const convertedMetadata = new ModelBuilder().entity(ConvertedRow, entity => {
    entity.toTable('converted_rows');
    entity.hasKey(row => row.text);
    entity.property(row => row.strong).hasColumnType('text')
        .hasConversion(strongIdConverter).isRequired();
    entity.property(row => row.hidden).hasColumnType('text')
        .hasConversion(hiddenIdConverter).isRequired();
    entity.property(row => row.text).hasColumnType('text')
        .hasConversion(countedTrimming).isRequired();
    entity.property(row => row.parts).hasColumnType('text')
        .hasConversion(joinedParts).isRequired();
}).build().getEntity(ConvertedRow);

function converted(name: string): PropertyMetadata {
    return convertedMetadata.getProperty(name);
}

describe('writeVerifiedProperty through a value converter', () => {
    it('refuses a private-field identifier swapped for a different one', () => {
        const row = new ConvertedRow();
        defineAccessor(row, 'strong', () => new StrongId('WRONG'));

        expect(() => writeVerifiedProperty(
            row, converted('strong'), new StrongId('expected'),
            'ConvertedRow.strong',
        )).toThrow(
            'Property \'ConvertedRow.strong\' refused its assigned value.',
        );
    });

    it('accepts a rebuilt identifier carrying the same provider fact', () => {
        const row = new ConvertedRow();
        defineAccessor(row, 'strong', value =>
            new StrongId((value as StrongId).value));

        expect(writeVerifiedProperty(
            row, converted('strong'), new StrongId('expected'),
            'ConvertedRow.strong',
        )).toBeInstanceOf(StrongId);
    });

    it('refuses a non-enumerable value object holding a different value', () => {
        const row = new ConvertedRow();
        defineAccessor(row, 'hidden', () => new HiddenId('WRONG'));

        expect(() => writeVerifiedProperty(
            row, converted('hidden'), new HiddenId('expected'),
            'ConvertedRow.hidden',
        )).toThrow(
            'Property \'ConvertedRow.hidden\' refused its assigned value.',
        );
    });

    it('refuses an accessor that mutates a converted object in place', () => {
        const row = new ConvertedRow();
        defineAccessor(row, 'parts', value => {
            (value as { parts: string[] }).parts.push('extra');
            return value;
        });

        expect(() => writeVerifiedProperty(
            row, converted('parts'), { parts: ['a'] }, 'ConvertedRow.parts',
        )).toThrow(
            'Property \'ConvertedRow.parts\' refused its assigned value.',
        );
    });

    it('propagates a converter that throws while verifying the stored value', () => {
        const row = new ConvertedRow();
        defineAccessor(row, 'strong', () => ({}));

        expect(() => writeVerifiedProperty(
            row, converted('strong'), new StrongId('expected'),
            'ConvertedRow.strong',
        )).toThrow('unconvertible strong identifier');
    });

    it('converts an object model value the setter stored by reference', () => {
        const row = new ConvertedRow();
        strongConversions = 0;

        writeVerifiedProperty(
            row, converted('strong'), new StrongId('expected'),
            'ConvertedRow.strong',
        );

        expect(strongConversions).toBe(2);
    });

    it('accepts a verbatim primitive without invoking the converter', () => {
        const row = new ConvertedRow();
        textConversions = 0;

        expect(writeVerifiedProperty(
            row, converted('text'), 'ada', 'ConvertedRow.text',
        )).toBe('ada');
        expect(textConversions).toBe(0);
    });

    it('compares provider facts when a setter normalizes a primitive', () => {
        const row = new ConvertedRow();
        defineAccessor(row, 'text', value => ` ${String(value)} `);
        textConversions = 0;

        expect(writeVerifiedProperty(
            row, converted('text'), 'ada', 'ConvertedRow.text',
        )).toBe(' ada ');
        expect(textConversions).toBe(2);
    });
});

