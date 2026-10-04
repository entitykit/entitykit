import { Migration, migrationChecksum, type MigrationBuilder } from '../packages/core/src/migrations';
import published from './fixtures/migration-checksum-values.json';
import { requireDefined } from './support/require-defined';

class ValueChecksumMigration extends Migration {
    public readonly id = '20261003000000_ValueChecksum';
    public readonly name = 'ValueChecksum';

    constructor(private readonly value: unknown) {
        super();
    }

    public override up(builder: MigrationBuilder): void {
        builder.sql('select $1', [this.value]);
    }

    public override down(builder: MigrationBuilder): void {
        builder.sql('select $1', [this.value]);
    }
}

function checksum(value: unknown): string {
    return migrationChecksum(new ValueChecksumMigration(value));
}

const publishedValues: ReadonlyArray<readonly [string, unknown]> = [
    ['null', null], ['undefined', undefined], ['false', false], ['empty string', ''],
    ['finite number', 123.5], ['negative zero', -0], ['NaN', NaN],
    ['positive infinity', Infinity], ['negative infinity', -Infinity],
    ['bigint', 9007199254740993n], ['date', new Date('2026-10-03T00:00:00.000Z')],
    ['bytes', new Uint8Array([1, 2])], ['nested array', [null, undefined, 1n, { value: true }]],
    ['ordered object', { z: [{ second: 2, first: 1 }], a: true }],
];

describe('migration checksum value boundaries', () => {
    it.each(publishedValues)('retains the published alpha.1 checksum for %s', (name, value) => {
        const expected = requireDefined(published.checksums.find(item => item.name === name));
        expect(checksum(value)).toBe(expected.checksum);
    });

    it.each([
        ['null and undefined', null, undefined],
        ['number and string', 1, '1'],
        ['number and bigint', 1, 1n],
        ['boolean and string', true, 'true'],
        ['opposite booleans', true, false],
        ['positive and negative zero', 0, -0],
        ['NaN and text', NaN, 'NaN'],
        ['infinity and text', Infinity, 'Infinity'],
        ['negative infinity and text', -Infinity, '-Infinity'],
        ['opposite infinities', Infinity, -Infinity],
        ['date and text', new Date('2026-10-03T00:00:00.000Z'), '2026-10-03T00:00:00.000Z'],
        ['bytes and base64 text', new Uint8Array([1, 2]), 'AQI='],
        ['array and object', [1, 2], { 0: 1, 1: 2 }],
        ['absent and undefined property', {}, { value: undefined }],
        ['different array order', [1, 2], [2, 1]],
        ['empty array and null element', [], [null]],
    ])('keeps %s distinct in persisted migration identity', (_description, first, second) => {
        expect(checksum(first)).not.toBe(checksum(second));
    });

    it('canonicalizes nested object order and null-prototype objects', () => {
        const plain = { z: [{ second: 2, first: 1 }], a: true };
        const nullPrototype = Object.assign(Object.create(null) as Record<string, unknown>, {
            a: true, z: [{ first: 1, second: 2 }],
        });
        expect(checksum(plain)).toBe(checksum(nullPrototype));
    });

    it('hashes only a byte view rather than its unused backing storage', () => {
        const backing = new Uint8Array([9, 1, 2, 8]);
        const view = backing.subarray(1, 3);
        expect(checksum(view)).toBe(checksum(new Uint8Array([1, 2])));
        expect(checksum(view)).toBe(checksum(Buffer.from([1, 2])));
        expect(checksum(view)).not.toBe(checksum(backing));
        backing[0] = 7;
        backing[3] = 6;
        expect(checksum(view)).toBe(checksum(new Uint8Array([1, 2])));
    });

    it('permits shared acyclic values independently in each SQL binding', () => {
        const shared = { value: [1, 2] };
        expect(checksum([shared, shared])).toBe(checksum([{ value: [1, 2] }, { value: [1, 2] }]));
    });

    it.each(['object', 'array'])('rejects %s cycles before producing a checksum', kind => {
        const value: Record<string, unknown> | unknown[] = kind === 'object' ? {} : [];
        if (Array.isArray(value)) value.push(value);
        else value.self = value;
        expect(() => checksum(value)).toThrow('Migration checksum values cannot contain cycles.');
    });

    it.each([
        [new Map(), 'Map'],
        [new Set(), 'Set'],
        [/pattern/g, 'RegExp'],
        [new Uint16Array([1]), 'Uint16Array'],
        [new ArrayBuffer(2), 'ArrayBuffer'],
        [new class CustomValue {}(), 'CustomValue'],
        [new class {}(), 'custom'],
    ])('rejects unsupported %s objects with a useful type diagnostic', (value, name) => {
        expect(() => checksum(value)).toThrow(`Migration checksum values cannot contain ${name} objects.`);
    });

    it.each([
        [Symbol('migration'), 'symbol'],
        [function callback(): number {
            return 1;
        }, 'function'],
    ])('rejects executable or symbolic %s values', (value, name) => {
        expect(() => checksum(value)).toThrow(`Migration checksum values cannot contain ${name} values.`);
    });

    it('rejects an invalid Date before writing an unstable identity', () => {
        expect(() => checksum(new Date(NaN))).toThrow(RangeError);
    });
});
