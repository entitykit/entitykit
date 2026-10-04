import { DbContext, type ModelBuilder } from '../packages/core/src';
import { createSqliteDataSource } from '../packages/sqlite/src';

class Record {
    constructor(public id: string, public active: boolean, public recordedAt: Date, public bytes: Uint8Array) {}
}
class Context extends DbContext {
    public readonly records = this.set(Record);
    protected override model(model: ModelBuilder): void {
        model.entity(Record, entity => {
            entity.toTable('records').hasKey(record => record.id);
            entity.property(record => record.id).hasColumnType('text').isRequired();
            entity.property(record => record.active).hasColumnType('boolean').isRequired();
            entity.property(record => record.recordedAt).hasColumnType('timestamp').isRequired();
            entity.property(record => record.bytes).hasColumnType('blob').isRequired();
            entity.materializeChecked(row => new Record(
                row.required(record => record.id), row.required(record => record.active),
                row.required(record => record.recordedAt), row.required(record => record.bytes),
            ));
        });
    }
}

describe('checked reads through SQLite', () => {
    it('checks normalized booleans, dates, and bytes on tracked and untracked reads', async () => {
        const source = createSqliteDataSource(':memory:');
        try {
            await using db = source.createContext(Context);
            await db.database.connection.query({
                text: 'create table records (id text primary key, active boolean, recordedAt timestamp, bytes blob)', values: [],
            });
            const date = new Date('2026-01-01T00:00:00.000Z');
            db.records.create('one', true, date, new Uint8Array([1, 2, 3]));
            await db.saveChanges();
            db.clearTracking();
            const tracked = await db.records.findOrThrow('one');
            const untracked = await db.records.asNoTracking().first();
            expect(tracked).toBeInstanceOf(Record);
            expect(untracked).toEqual(tracked);
            expect(untracked).not.toBe(tracked);
            expect(tracked.active).toBe(true);
            expect(tracked.recordedAt).toEqual(date);
            expect(tracked.bytes).toEqual(new Uint8Array([1, 2, 3]));
            expect(db.entry(untracked)).toBeUndefined();
        } finally {
            await source.dispose();
        }
    });
});
