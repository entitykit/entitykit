import { requireDefined } from '../support/require-defined';
import type {
    DbContextOptionsBuilder,
    ModelBuilder } from '../../packages/core/src';
import {
    DbContext,
    bigintAsBigInt,
    dateOnlyAsString,
    dateOnlyAsUtcDate,
    numericAsString,
} from '../../packages/core/src';
import { postgresProviderServices } from '../../packages/postgres/src';

const shouldRunPostgresTests = process.env.RUN_POSTGRES_TESTS === 'true' && Boolean(process.env.DATABASE_URL);
const describePostgres = shouldRunPostgresTests ? describe : describe.skip;

class Invoice {
    public id!: string;
    public amount!: string;
    public lineCount!: bigint;
    public issuedOn!: Date;
    public dueOn!: string;

    constructor(data?: Partial<Invoice>) {
        Object.assign(this, data);
    }
}

class InvoiceContext extends DbContext {
    public invoices = this.set(Invoice);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(postgresProviderServices, requireDefined(process.env.DATABASE_URL));
    }

    protected override model(model: ModelBuilder): void {
        model.entity(Invoice, entity => {
            entity.toTable('numeric_converter_invoices');
            entity.hasKey(invoice => invoice.id);
            entity.property(invoice => invoice.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(invoice => invoice.amount).hasColumnName('amount').hasColumnType('numeric').isRequired()
                .hasConversion(numericAsString());
            entity.property(invoice => invoice.lineCount).hasColumnName('line_count').hasColumnType('bigint').isRequired()
                .hasConversion(bigintAsBigInt());
            entity.property(invoice => invoice.issuedOn).hasColumnName('issued_on').hasColumnType('date').isRequired()
                .hasConversion(dateOnlyAsUtcDate());
            entity.property(invoice => invoice.dueOn).hasColumnName('due_on').hasColumnType('date').isRequired()
                .hasConversion(dateOnlyAsString());
        });
    }
}

describePostgres('exact numeric converters against live Postgres', () => {
    let db: InvoiceContext;

    beforeEach(async () => {
        db = InvoiceContext.create();
        await db.database.connection.query({ text: 'drop table if exists "numeric_converter_invoices" cascade', values: [] });
        await db.database.connection.query({ text: db.database.createScript(), values: [] });
    });

    afterEach(async () => {
        await db.database.connection.query({ text: 'drop table if exists "numeric_converter_invoices" cascade', values: [] });
        await db.dispose();
    });

    it('produces the same JavaScript types SQLite produces for the same model', async () => {
        db.invoices.add(new Invoice({
            id: 'inv_1',
            amount: '1234.56',
            lineCount: 7n,
            issuedOn: new Date('2026-03-04T00:00:00.000Z'),
            dueOn: '2026-04-03',
        }));
        await db.saveChanges();
        db.changeTracker.clear();

        const loaded = await db.invoices.find('inv_1');
        // Without the converter `pg` returns strings and SQLite returns numbers for
        // both columns; the converter is what makes one model behave the same way.
        expect(typeof requireDefined(loaded).amount).toBe('string');
        expect(requireDefined(loaded).amount).toBe('1234.56');
        expect(typeof requireDefined(loaded).lineCount).toBe('bigint');
        expect(requireDefined(loaded).lineCount).toBe(7n);
        expect(requireDefined(loaded).issuedOn.toISOString()).toBe('2026-03-04T00:00:00.000Z');
        expect(requireDefined(loaded).dueOn).toBe('2026-04-03');
    });

    it('stores the calendar day it was given regardless of server timezone', async () => {
        db.invoices.add(new Invoice({
            id: 'inv_tz',
            amount: '1.00',
            lineCount: 1n,
            issuedOn: new Date('2026-03-04T00:00:00.000Z'),
            dueOn: '2026-03-04',
        }));
        await db.saveChanges();

        // Read the raw stored day. Without the converter, `pg` serializes a Date
        // using the process timezone, so a UTC-midnight date stores the previous
        // day on any server west of Greenwich.
        const raw = await db.database.connection.query<{ issued_on: string; due_on: string }>({
            text: 'select "issued_on"::text as issued_on, "due_on"::text as due_on from "numeric_converter_invoices" where "id" = $1',
            values: ['inv_tz'],
        });
        expect(raw.rows[0]).toEqual({ issued_on: '2026-03-04', due_on: '2026-03-04' });

        db.changeTracker.clear();
        const loaded = await db.invoices.find('inv_tz');
        expect(requireDefined(loaded).issuedOn.toISOString()).toBe('2026-03-04T00:00:00.000Z');
        expect(requireDefined(loaded).dueOn).toBe('2026-03-04');
    });

    it('keeps exact values Postgres can store but a double cannot', async () => {
        db.invoices.add(new Invoice({
            id: 'inv_2',
            amount: '12345678901234567890.12345',
            lineCount: 9007199254740993n,
            issuedOn: new Date('2026-03-04T00:00:00.000Z'),
            dueOn: '2026-04-03',
        }));
        await db.saveChanges();
        db.changeTracker.clear();

        const loaded = await db.invoices.find('inv_2');
        expect(requireDefined(loaded).amount).toBe('12345678901234567890.12345');
        expect(requireDefined(loaded).lineCount).toBe(9007199254740993n);
    });
});
