import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext } from '../packages/core/src';
import { sqliteProviderServices } from '../packages/sqlite/src';

class AuditedRecord {
    private nameValue = '';
    private nameReads = 0;
    private queuedNames: string[] = [];
    public id!: string;
    public updatedAt!: Date;

    public get name(): string {
        this.nameReads += 1;
        return this.queuedNames.shift() ?? this.nameValue;
    }

    public set name(value: string) {
        this.nameValue = value;
    }

    public returnNames(...values: string[]): void {
        this.nameReads = 0;
        this.queuedNames = [...values];
    }

    public get observedNameReads(): number {
        return this.nameReads;
    }
}

const oldTimestamp = new Date('2026-01-01T00:00:00.000Z');
const saveTimestamp = new Date('2026-08-05T12:00:00.000Z');

class AuditSnapshotContext extends DbContext {
    public records = this.set(AuditedRecord);

    protected override configure(options: DbContextOptionsBuilder): void {
        options
            .useProvider(sqliteProviderServices, ':memory:')
            .useAuditing({ now: () => saveTimestamp });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(AuditedRecord, entity => {
            entity.toTable('audited_records');
            entity.hasKey(record => record.id);
            entity.audit({ updatedAt: record => record.updatedAt });
            entity.property(record => record.id).hasColumnType('text').isRequired();
            entity.property(record => record.name).hasColumnType('text').isRequired();
            entity.property(record => record.updatedAt).hasColumnName('updated_at')
                .hasColumnType('text').isRequired();
        });
    }
}

describe('save-time audit snapshots', () => {
    it('audits a modification discovered by the executable value capture', async () => {
        const db = AuditSnapshotContext.create();
        await db.database.connection.query({
            text: db.database.createScript(),
            values: [],
        });
        await db.database.connection.query({
            text: 'insert into audited_records (id, name, updated_at) values (?, ?, ?)',
            values: ['record-1', 'original', oldTimestamp.toISOString()],
        });
        const record = Object.assign(new AuditedRecord(), {
            id: 'record-1',
            name: 'original',
            updatedAt: oldTimestamp,
        });
        db.records.attach(record);
        record.returnNames('changed', 'wrong-later');

        await expect(db.saveChanges()).resolves.toBe(1);

        const stored = await db.database.connection.query<{
            name: string;
            updated_at: string;
        }>({
            text: 'select name, updated_at from audited_records where id = ?',
            values: ['record-1'],
        });
        expect(stored.rows[0]).toEqual({
            name: 'changed',
            updated_at: saveTimestamp.toISOString(),
        });
        expect(record.updatedAt).toEqual(saveTimestamp);
        expect(record.observedNameReads).toBe(3);
        await db.dispose();
    });
});
