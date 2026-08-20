import type {
    DbContextOptionsBuilder,
    ModelBuilder,
} from '../packages/core/src';
import {
    DbContext,
} from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';

class NullableRecord {
    public id!: string;
    public label?: string | null;

    constructor(data?: Partial<NullableRecord>) {
        Object.assign(this, data);
    }
}

class NullableRecordContext extends DbContext {
    public records = this.set(NullableRecord);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(NullableRecord, entity => {
            entity.toTable('nullable_records');
            entity.hasKey(record => record.id);
            entity.property(record => record.id).hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(record => record.label).hasColumnName('label').hasColumnType('text');
        });
    }
}

describe('nullish query semantics', () => {
    it('matches null through equality and mixed membership', async () => {
        const db =  NullableRecordContext.create();
        await db.database.connection.query({ text: db.database.createScript(), values: [] });
        db.records.add(new NullableRecord({ id: 'null', label: null }));
        db.records.add(new NullableRecord({ id: 'one', label: 'one' }));
        db.records.add(new NullableRecord({ id: 'two', label: 'two' }));
        await db.saveChanges();
        db.changeTracker.clear();

        const ids = async (
            query: ReturnType<NullableRecordContext['records']['where']>,
        ): Promise<string[]> =>
            (await query.orderBy(record => record.id).toArray()).map(record => record.id);

        expect(await ids(db.records.where(record =>
            record.label.in(['one', 'two']),
        ))).toEqual(['one', 'two']);
        expect(await ids(db.records.where(record =>
            record.label.in([null, 'one']),
        ))).toEqual(['null', 'one']);
        expect(await ids(db.records.where(record =>
            record.label.in([undefined]),
        ))).toEqual(['null']);
        expect(await ids(db.records.where(record =>
            record.label.eq(undefined),
        ))).toEqual(['null']);

        await db.dispose();
    });
});
