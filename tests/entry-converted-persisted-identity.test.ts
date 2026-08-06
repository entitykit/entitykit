import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext, valueConverter } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';
import { requireDefined } from './support/require-defined';

class StrongKey {
    readonly #value: string;

    constructor(value: string) {
        this.#value = value;
    }

    public get value(): string {
        return this.#value;
    }
}

const strongKey = valueConverter<StrongKey, string>({
    toProvider: value => value.value,
    fromProvider: value => new StrongKey(value),
});

class ConvertedIdentityRow {
    public id = new StrongKey('');
    public name = '';
}

class ConvertedIdentityContext extends DbContext {
    public rows = this.set(ConvertedIdentityRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(ConvertedIdentityRow, entity => {
            entity.toTable('converted_identity_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text')
                .hasConversion(strongKey).isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
        });
    }
}

describe('converted entry persisted identity', () => {
    it('reloads a strong-key entry by its original provider identity', async () => {
        const db = ConvertedIdentityContext.create();
        await db.database.connection.query({
            text: db.database.createScript(),
            values: [],
        });
        await db.database.connection.query({
            text: `insert into converted_identity_rows (id, name)
                values (?, ?), (?, ?)`,
            values: ['one', 'first', 'two', 'second'],
        });
        const row = requireDefined(await db.rows.find(new StrongKey('one')));
        const entry = requireDefined(db.entry(row));
        row.id = new StrongKey('two');

        const values = requireDefined(await entry.getDatabaseValues());
        expect(values.get('id').value).toBe('one');
        await expect(entry.reload()).resolves.toBe(true);

        expect(row.id.value).toBe('one');
        expect(row.name).toBe('first');
        expect(await db.rows.find(new StrongKey('one'))).toBe(row);
        const second = requireDefined(await db.rows.find(new StrongKey('two')));
        expect(second).not.toBe(row);
        expect(second.name).toBe('second');
        expect(db.changeTracker.entries()).toHaveLength(2);
        await db.dispose();
    });
});
