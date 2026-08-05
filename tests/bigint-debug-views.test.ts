import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext } from '../src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class BigIntRecord {
    public id!: bigint;
    public value!: bigint;
}

class BigIntDebugContext extends DbContext {
    public records = this.set(BigIntRecord);

    constructor(private readonly connection: RecordingDatabaseConnection) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(this.connection);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(BigIntRecord, entity => {
            entity.toTable('bigint_records');
            entity.hasKey(item => item.id);
            entity.property(item => item.id).hasColumnType('bigint').isRequired();
            entity.property(item => item.value).hasColumnType('bigint').isRequired();
        });
    }
}

describe('bigint debug views', () => {
    it('formats save-plan keys and parameters without JSON serialization', () => {
        const connection = new RecordingDatabaseConnection();
        const db = BigIntDebugContext.create(connection);
        db.records.add(Object.assign(new BigIntRecord(), {
            id: 9007199254740993n,
            value: 9007199254740995n,
        }));

        expect(db.getSavePlanDebugView()).toContain(
            'BigIntRecord { 9007199254740993n } Added',
        );
        expect(db.getSavePlanDebugView()).toContain(
            'params: [9007199254740993n, 9007199254740995n]',
        );
    });

    it('formats tracker keys and modified values without throwing', () => {
        const connection = new RecordingDatabaseConnection();
        const db = BigIntDebugContext.create(connection);
        const item = Object.assign(new BigIntRecord(), {
            id: 9007199254740993n,
            value: 1n,
        });
        db.records.attach(item);
        item.value = 2n;

        expect(db.changeTracker.debugView()).toContain(
            'BigIntRecord { id: 9007199254740993n } Modified',
        );
        expect(db.changeTracker.debugView()).toContain(
            'value: 1n -> 2n',
        );
    });
});
