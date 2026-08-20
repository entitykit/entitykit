import { requireDefined } from './support/require-defined';
import type {
    DbContextOptionsBuilder,
    ModelBuilder } from '../packages/core/src';
import {
    DbContext,
    bigintAsBigInt,
    bigintAsNumber,
    dateOnlyAsString,
    dateOnlyAsUtcDate,
    numericAsNumber,
    numericAsString,
} from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';

describe('exact numeric value converters', () => {
    // `pg` returns numeric/bigint columns as strings; SQLite returns numbers.
    // Converters must accept either and produce one type.
    it('reads numeric columns as strings from either provider representation', () => {
        const converter = numericAsString();

        expect(converter.fromProvider('1234.56')).toBe('1234.56');
        expect(converter.fromProvider(1234.56)).toBe('1234.56');
        expect(converter.toProvider('1234.56')).toBe('1234.56');
    });

    it('reads numeric columns as numbers from either provider representation', () => {
        const converter = numericAsNumber();

        expect(converter.fromProvider('1234.56')).toBe(1234.56);
        expect(converter.fromProvider(1234.56)).toBe(1234.56);
        expect(converter.toProvider(1234.56)).toBe(1234.56);
    });

    it('reads bigint columns as bigints from either provider representation', () => {
        const converter = bigintAsBigInt();

        expect(converter.fromProvider('9007199254740993')).toBe(9007199254740993n);
        expect(converter.fromProvider(42)).toBe(42n);
        expect(converter.fromProvider(42n)).toBe(42n);
        // Text binds correctly for both pg int8 and SQLite integer affinity.
        expect(converter.toProvider(9007199254740993n)).toBe('9007199254740993');
    });

    it('refuses bigint values that a number cannot represent', () => {
        const converter = bigintAsNumber();

        expect(converter.fromProvider('42')).toBe(42);
        expect(converter.fromProvider(42)).toBe(42);
        expect(() => converter.fromProvider('9007199254740993'))
            .toThrow('outside the safe integer range');
    });

    it('refuses bigint values that are not integers instead of truncating', () => {
        expect(() => bigintAsBigInt().fromProvider(1.5)).toThrow();
        expect(() => bigintAsBigInt().fromProvider(true)).toThrow('Cannot read a bigint column');
    });
});

describe('calendar date value converters', () => {
    // A SQL `date` is a calendar day; a JS `Date` is an instant. `pg` bridges the
    // two with the process timezone, which silently shifts the stored day.
    it('keeps a calendar day as text on both sides of the wire', () => {
        const converter = dateOnlyAsString();

        expect(converter.toProvider('2026-03-04')).toBe('2026-03-04');
        // SQLite returns the stored text.
        expect(converter.fromProvider('2026-03-04')).toBe('2026-03-04');
        // `pg` returns a Date at local midnight of the stored day.
        expect(converter.fromProvider(new Date(2026, 2, 4, 0, 0, 0))).toBe('2026-03-04');
    });

    it('normalizes a calendar day to UTC midnight regardless of provider', () => {
        const converter = dateOnlyAsUtcDate();

        const fromText = converter.fromProvider('2026-03-04');
        expect(fromText.toISOString()).toBe('2026-03-04T00:00:00.000Z');

        const fromLocalMidnight = converter.fromProvider(new Date(2026, 2, 4, 0, 0, 0));
        expect(fromLocalMidnight.toISOString()).toBe('2026-03-04T00:00:00.000Z');

        // Writes send text, so the driver never applies a local-day conversion.
        expect(converter.toProvider(new Date('2026-03-04T00:00:00.000Z'))).toBe('2026-03-04');
    });

    it('rejects values that are not calendar days', () => {
        expect(() => dateOnlyAsString().fromProvider('not a date')).toThrow('Expected a YYYY-MM-DD value');
    });
});

class Invoice {
    public id!: string;
    public amount!: string;
    public lineCount!: bigint;
    public issuedOn!: Date;
    public tags!: string[];

    constructor(data?: Partial<Invoice>) {
        Object.assign(this, data);
    }
}

class InvoiceContext extends DbContext {
    public invoices = this.set(Invoice);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Invoice, entity => {
            entity.toTable('invoices');
            entity.hasKey(invoice => invoice.id);
            entity.property(invoice => invoice.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(invoice => invoice.amount).hasColumnName('amount').hasColumnType('numeric').isRequired()
                .hasConversion(numericAsString());
            entity.property(invoice => invoice.lineCount).hasColumnName('line_count').hasColumnType('bigint').isRequired()
                .hasConversion(bigintAsBigInt());
            entity.property(invoice => invoice.issuedOn).hasColumnName('issued_on').hasColumnType('date').isRequired()
                .hasConversion(dateOnlyAsUtcDate());
            entity.property(invoice => invoice.tags).hasColumnName('tags').hasColumnType('text[]').isRequired();
        });
    }
}

describe('value converters through a DbContext', () => {
    it('round-trips converted values on SQLite', async () => {
        const db = InvoiceContext.create();
        await db.database.connection.query({ text: db.database.createScript(), values: [] });

        db.invoices.add(new Invoice({
            id: 'inv_1',
            amount: '1234.56',
            lineCount: 7n,
            issuedOn: new Date('2026-03-04T00:00:00.000Z'),
            tags: ['urgent', 'net30'],
        }));
        await db.saveChanges();
        db.changeTracker.clear();

        const loaded = await db.invoices.find('inv_1');
        expect(typeof requireDefined(loaded).amount).toBe('string');
        expect(requireDefined(loaded).amount).toBe('1234.56');
        expect(typeof requireDefined(loaded).lineCount).toBe('bigint');
        expect(requireDefined(loaded).lineCount).toBe(7n);
        expect(requireDefined(loaded).issuedOn.toISOString()).toBe('2026-03-04T00:00:00.000Z');
        // SQLite stores arrays as JSON text and reads them back as arrays.
        expect(requireDefined(loaded).tags).toEqual(['urgent', 'net30']);

        await db.dispose();
    });
});
