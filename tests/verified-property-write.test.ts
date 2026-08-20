import { valueConverter } from '../packages/core/src';
import { ModelBuilder } from '../packages/core/src/model/model-builder';
import type { PropertyMetadata } from '../packages/core/src/model/property-metadata';
import {
    writeVerifiedPath,
    writeVerifiedProperty,
} from '../packages/core/src/verified-property-write';

const trimming = valueConverter<string, string>({
    toProvider: value => value.trim(),
    fromProvider: value => value,
});

class VerifiedRow {
    public value = 'before';
    public tag = 'before';
    public items: string[] = [];
}

const metadata = new ModelBuilder().entity(VerifiedRow, entity => {
    entity.toTable('verified_rows');
    entity.hasKey(row => row.value);
    entity.property(row => row.value).hasColumnType('text').isRequired();
    entity.property(row => row.tag).hasColumnType('text')
        .hasConversion(trimming).isRequired();
    entity.property(row => row.items).hasColumnType('json');
}).build().getEntity(VerifiedRow);

function property(name: string): PropertyMetadata {
    return metadata.getProperty(name);
}

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

describe('writeVerifiedProperty', () => {
    it('returns the stored value when the accessor accepts the assignment', () => {
        const row = new VerifiedRow();

        expect(writeVerifiedProperty(
            row, property('value'), 'after', 'VerifiedRow.value',
        )).toBe('after');
        expect(row.value).toBe('after');
    });

    it('rejects an accessor that silently refuses the assignment', () => {
        const row = new VerifiedRow();
        defineAccessor(row, 'value', () => 'before');

        expect(() => writeVerifiedProperty(
            row, property('value'), 'after', 'VerifiedRow.value',
        )).toThrow('Property \'VerifiedRow.value\' refused its assigned value.');
        expect(row.value).toBe('before');
    });

    it('rejects an accessor that silently normalizes the assignment', () => {
        const row = new VerifiedRow();
        defineAccessor(row, 'value', value => String(value).toUpperCase());

        expect(() => writeVerifiedProperty(
            row, property('value'), 'after', 'VerifiedRow.value',
        )).toThrow('Property \'VerifiedRow.value\' refused its assigned value.');
    });

    it('accepts a stored value that stays equal through the converter', () => {
        const row = new VerifiedRow();
        defineAccessor(row, 'tag', value => ` ${String(value)} `);

        expect(writeVerifiedProperty(
            row, property('tag'), 'ada', 'VerifiedRow.tag',
        )).toBe(' ada ');
    });

    it('accepts a structurally identical copy of a value object', () => {
        const row = new VerifiedRow();
        defineAccessor(row, 'items', value => [...value as string[]]);

        expect(writeVerifiedProperty(
            row, property('items'), ['a', 'b'], 'VerifiedRow.items',
        )).toEqual(['a', 'b']);
    });

    it('rejects an accessor that mutates the assigned value in place', () => {
        const row = new VerifiedRow();
        defineAccessor(row, 'items', value => {
            (value as string[]).push('extra');
            return value;
        });

        expect(() => writeVerifiedProperty(
            row, property('items'), ['a'], 'VerifiedRow.items',
        )).toThrow('Property \'VerifiedRow.items\' refused its assigned value.');
    });
});

class NestedRow {
    public scope: { city?: string } | null = null;
}

describe('writeVerifiedPath', () => {
    it('returns the stored object for an accepted complex assignment', () => {
        const row = new NestedRow();
        const value = { city: 'Paris' };

        expect(writeVerifiedPath(
            row, ['scope'], value, 'NestedRow.scope',
        )).toBe(value);
    });

    it('accepts a nullish assignment observed as the same nullish shape', () => {
        const row = new NestedRow();
        row.scope = { city: 'Paris' };

        expect(writeVerifiedPath(
            row, ['scope'], null, 'NestedRow.scope',
        )).toBeNull();
    });

    it('rejects a complex root that keeps an object after a null assignment', () => {
        const row = new NestedRow();
        defineAccessor(row, 'scope', () => ({ city: 'Paris' }));

        expect(() => writeVerifiedPath(
            row, ['scope'], null, 'NestedRow.scope',
        )).toThrow('Property \'NestedRow.scope\' refused its assigned value.');
    });

    it('rejects a complex root that stays null after an object assignment', () => {
        const row = new NestedRow();
        defineAccessor(row, 'scope', () => null);

        expect(() => writeVerifiedPath(
            row, ['scope'], { city: 'Paris' }, 'NestedRow.scope',
        )).toThrow('Property \'NestedRow.scope\' refused its assigned value.');
    });

    it('accepts a complex root replaced by a different object', () => {
        const row = new NestedRow();
        const replacement = { city: 'Berlin' };
        defineAccessor(row, 'scope', () => replacement);

        expect(writeVerifiedPath(
            row, ['scope'], { city: 'Paris' }, 'NestedRow.scope',
        )).toBe(replacement);
    });

    it('rejects a complex root that stores a primitive for an object', () => {
        const row = new NestedRow();
        defineAccessor(row, 'scope', () => 'Paris');

        expect(() => writeVerifiedPath(
            row, ['scope'], { city: 'Paris' }, 'NestedRow.scope',
        )).toThrow('Property \'NestedRow.scope\' refused its assigned value.');
    });

    it('compares a requested primitive exactly', () => {
        const row = new NestedRow();
        row.scope = {};
        defineAccessor(row.scope, 'city', () => 'Berlin');

        expect(() => writeVerifiedPath(
            row, ['scope', 'city'], 'Paris', 'NestedRow.scope.city',
        )).toThrow(
            'Property \'NestedRow.scope.city\' refused its assigned value.',
        );
    });

    it('rejects a refused ancestor even when the leaf reads back nullish', () => {
        const row = new NestedRow();
        defineAccessor(row, 'scope', () => null);

        expect(() => writeVerifiedPath(
            row, ['scope', 'city'], null, 'NestedRow.scope.city',
        )).toThrow(
            'Property \'NestedRow.scope.city\' refused its assigned value.',
        );
    });

    it('rejects an ancestor that reads back as a primitive', () => {
        const row = new NestedRow();
        defineAccessor(row, 'scope', () => 'oops');

        expect(() => writeVerifiedPath(
            row, ['scope', 'city'], undefined, 'NestedRow.scope.city',
        )).toThrow(
            'Property \'NestedRow.scope.city\' refused its assigned value.',
        );
    });

    it('creates and verifies a missing ancestor before writing the leaf', () => {
        const row = new NestedRow();

        expect(writeVerifiedPath(
            row, ['scope', 'city'], 'Paris', 'NestedRow.scope.city',
        )).toBe('Paris');
        expect(row.scope?.city).toBe('Paris');
    });
});
