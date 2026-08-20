import type {
    DbContextOptionsBuilder,
    ModelBuilder,
} from '../packages/core/src';
import { DbContext } from '../packages/core/src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class CacheRecord {
    public id!: string;
    public value!: unknown;
}

class CacheContext extends DbContext {
    public records = this.set(CacheRecord);

    constructor(public readonly connection: RecordingDatabaseConnection) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(this.connection);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(CacheRecord, entity => {
            entity.toTable('cache_records');
            entity.hasKey(record => record.id);
            entity.property(record => record.id)
                .hasColumnName('id').hasColumnType('text').isRequired();
            entity.property(record => record.value)
                .hasColumnName('value').hasColumnType('text');
        });
    }
}

describe('compiled query parameter contract', () => {
    it('rejects invalid cache-hit values before calling the provider', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = CacheContext.create(connection);
        await db.records.where(record => record.value.eq('valid')).toArray();
        expect(connection.statements).toHaveLength(1);

        const unhandled: unknown[] = [];
        const observeUnhandled = (reason: unknown): void => {
            unhandled.push(reason);
        };
        process.on('unhandledRejection', observeUnhandled);
        try {
            const rejected = Promise.reject(new Error('forgot await'));
            await expect(db.records.where(record =>
                record.value.eq(rejected)).toArray())
                .rejects.toThrow('SQL parameters cannot be Promises');
            await expect(db.records.where(record =>
                record.value.eq(new Date(Number.NaN))).toArray())
                .rejects.toThrow('Invalid Date at \'CacheRecord.value\'');
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(unhandled).toEqual([]);
            expect(connection.statements).toHaveLength(1);
        } finally {
            process.off('unhandledRejection', observeUnhandled);
        }
    });
});
