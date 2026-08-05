import type {
    DbContextOptionsBuilder,
    ModelBuilder,
    ValueConverter,
} from '../src';
import { DbContext, EntityState } from '../src';
import { sqliteProviderServices } from '../src/providers/sqlite';

type ConverterMode = 'sync' | 'resolve' | 'reject';

let writeMode: ConverterMode;
let readMode: ConverterMode;

function converterResult(
    mode: ConverterMode,
    value: unknown,
    failure: string,
): unknown {
    if (mode === 'resolve') {
        return Promise.resolve(value);
    }
    if (mode === 'reject') {
        return Promise.reject(new Error(failure));
    }
    return value;
}

const converter: ValueConverter = {
    toProvider: value => converterResult(
        writeMode,
        `stored:${String(value)}`,
        'write conversion failed',
    ),
    fromProvider: value => converterResult(
        readMode,
        String(value).replace('stored:', ''),
        'read conversion failed',
    ),
};

class ConvertedRecord {
    public id!: string;
    public secret!: string;

    constructor(values?: Partial<ConvertedRecord>) {
        Object.assign(this, values);
    }
}

class ConverterSqliteContext extends DbContext {
    public records = this.set(ConvertedRecord);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(ConvertedRecord, entity => {
            entity.toTable('converted_records');
            entity.hasKey(record => record.id);
            entity.property(record => record.id)
                .hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(record => record.secret)
                .hasColumnName('secret').hasColumnType('text').isRequired()
                .hasConversion(converter as ValueConverter<string>);
        });
    }
}

describe('value converter synchronous contract against SQLite', () => {
    let db: ConverterSqliteContext;
    const unhandled: unknown[] = [];
    const observeUnhandled = (reason: unknown): void => {
        unhandled.push(reason);
    };

    beforeEach(async () => {
        writeMode = 'sync';
        readMode = 'sync';
        unhandled.length = 0;
        process.on('unhandledRejection', observeUnhandled);
        db = ConverterSqliteContext.create();
        await db.database.connection.query({
            text: db.database.createScript(),
            values: [],
        });
    });

    afterEach(async () => {
        process.off('unhandledRejection', observeUnhandled);
        await db.dispose();
    });

    it.each(['resolve', 'reject'] as const)(
        'rejects a %s promise on write without storing a row',
        async mode => {
            const record = new ConvertedRecord({ id: `record_${mode}`, secret: 'value' });
            db.records.add(record);
            writeMode = mode;

            await expect(db.saveChanges()).rejects.toThrow(
                'Value converter for \'ConvertedRecord.secret\' toProvider() must be synchronous',
            );
            await new Promise<void>(resolve => setImmediate(resolve));

            const count = await db.database.connection.query<{ count: number }>({
                text: 'select count(*) as "count" from "converted_records"',
                values: [],
            });
            expect(count.rows[0]?.count).toBe(0);
            expect(db.entry(record)?.state).toBe(EntityState.Added);
            expect(unhandled).toEqual([]);

            writeMode = 'sync';
            await expect(db.saveChanges()).resolves.toBe(1);
            const stored = await db.database.connection.query<{ secret: string }>({
                text: 'select "secret" from "converted_records" where "id" = ?',
                values: [record.id],
            });
            expect(stored.rows[0]?.secret).toBe('stored:value');
            expect(db.entry(record)?.state).toBe(EntityState.Unchanged);
        },
    );

    it.each(['resolve', 'reject'] as const)(
        'rejects a %s promise on read without tracking a partial entity',
        async mode => {
            await db.database.connection.query({
                text: 'insert into "converted_records" ("id", "secret") values (?, ?)',
                values: [`record_${mode}`, 'stored:value'],
            });
            readMode = mode;

            await expect(db.records.toArray()).rejects.toThrow(
                'Value converter for \'ConvertedRecord.secret\' fromProvider() must be synchronous',
            );
            await new Promise<void>(resolve => setImmediate(resolve));

            expect(db.changeTracker.entries()).toEqual([]);
            expect(unhandled).toEqual([]);

            readMode = 'sync';
            await expect(db.records.toArray()).resolves.toEqual([
                expect.objectContaining({
                    id: `record_${mode}`,
                    secret: 'value',
                }),
            ]);
            expect(db.changeTracker.entries()).toHaveLength(1);
        },
    );
});
