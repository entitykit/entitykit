import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext, valueConverter } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { requireDefined } from './support/require-defined';

class EntryStrongId {
    readonly #value: string;

    constructor(value: string) {
        this.#value = value;
    }

    public providerValue(): string {
        return this.#value;
    }
}

const strongId = valueConverter<EntryStrongId, string>({
    toProvider: value => value.providerValue(),
    fromProvider: value => new EntryStrongId(value),
});
let nonKeyReads = 0;
const countedName = valueConverter<string, string>({
    toProvider: value => value,
    fromProvider: value => {
        nonKeyReads += 1;
        return value;
    },
});

class EntryKeyRow {
    public id = new EntryStrongId('');
    public name = '';
}

class CompositeEntryKeyRow {
    public region = '';
    public id = new EntryStrongId('');
}

class EntryKeyContext extends DbContext {
    public rows = this.set(EntryKeyRow);
    public compositeRows = this.set(CompositeEntryKeyRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(EntryKeyRow, entity => {
            entity.toTable('entry_key_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text')
                .hasConversion(strongId).isRequired();
            entity.property(row => row.name).hasColumnType('text')
                .hasConversion(countedName).isRequired();
        });
        model.entity(CompositeEntryKeyRow, entity => {
            entity.toTable('composite_entry_key_rows');
            entity.hasKey(row => [row.region, row.id]);
            entity.property(row => row.region).hasColumnType('text').isRequired();
            entity.property(row => row.id).hasColumnType('text')
                .hasConversion(strongId).isRequired();
        });
    }
}

describe('EntityEntry persisted key value', () => {
    it('keeps the registered converted key after a live key edit', () => {
        const db = EntryKeyContext.create();
        const row = Object.assign(new EntryKeyRow(), {
            id: new EntryStrongId('registered'), name: 'row',
        });
        db.rows.attach(row);
        row.id = new EntryStrongId('edited');

        const key = requireDefined(db.entry(row)).keyValue as EntryStrongId;

        expect(key.providerValue()).toBe('registered');
    });

    it('keeps every registered composite key component', () => {
        const db = EntryKeyContext.create();
        const row = Object.assign(new CompositeEntryKeyRow(), {
            region: 'north', id: new EntryStrongId('registered'),
        });
        db.compositeRows.attach(row);
        row.region = 'south';
        row.id = new EntryStrongId('edited');

        const key = requireDefined(db.entry(row)).keyValue as [
            string, EntryStrongId,
        ];

        expect(key[0]).toBe('north');
        expect(key[1].providerValue()).toBe('registered');
    });

    it('does not reconstruct unrelated converted properties', () => {
        const db = EntryKeyContext.create();
        const row = Object.assign(new EntryKeyRow(), {
            id: new EntryStrongId('registered'), name: 'row',
        });
        db.rows.attach(row);
        nonKeyReads = 0;

        const keyValue = requireDefined(db.entry(row)).keyValue;

        expect(keyValue).toBeInstanceOf(EntryStrongId);
        expect(nonKeyReads).toBe(0);
    });
});
