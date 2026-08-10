import type {
    DbContextOptionsBuilder,
    ModelBuilder,
    TransactionOptions,
} from '../src';
import { DbContext, EntityState } from '../src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class CommitWindowRecord {
    public id!: string;
    public throwOnNameRead = false;
    private nameValue!: string;

    public get name(): string {
        if (this.throwOnNameRead) {
            throw new Error('name unavailable');
        }
        return this.nameValue;
    }

    public set name(value: string) {
        this.nameValue = value;
    }
}

class CommitWindowContext extends DbContext {
    public records = this.set(CommitWindowRecord);

    constructor(private readonly connection: RecordingDatabaseConnection) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(this.connection);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(CommitWindowRecord, entity => {
            entity.toTable('commit_window_records');
            entity.hasKey(record => record.id);
            entity.property(record => record.id).hasColumnType('text').isRequired();
            entity.property(record => record.name).hasColumnType('text').isRequired();
        });
    }
}

class DelayedCommitConnection extends RecordingDatabaseConnection {
    private releaseCommit?: () => void;
    private markCommitStarted?: () => void;
    private readonly commitGate: Promise<void> = new Promise(resolve => {
        this.releaseCommit = resolve;
    });
    public readonly commitStarted: Promise<void> = new Promise(resolve => {
        this.markCommitStarted = resolve;
    });

    public release(): void {
        this.releaseCommit?.();
    }

    public override async transaction<TResult>(
        work: () => TResult | Promise<TResult>,
        options?: TransactionOptions,
    ): Promise<TResult> {
        return super.transaction(async () => {
            const result = await work();
            this.markCommitStarted?.();
            await this.commitGate;
            return result;
        }, options);
    }
}

function trackedRecord(): CommitWindowRecord {
    const record = new CommitWindowRecord();
    record.id = 'record-1';
    record.name = 'original';
    return record;
}

describe('save commit-window reconciliation', () => {
    it('reports a scalar edit made after acceptance as modified when save resolves', async () => {
        const connection = new DelayedCommitConnection();
        connection.queueResult({ rowCount: 1 });
        const db = CommitWindowContext.create(connection);
        const record = trackedRecord();
        db.records.attach(record);
        record.name = 'persisted';

        const saving = db.saveChanges();
        await connection.commitStarted;
        record.name = 'after acceptance';
        connection.release();

        await expect(saving).resolves.toBe(1);
        expect(db.entry(record)?.originalValues.name).toBe('persisted');
        expect(db.entry(record)?.state).toBe(EntityState.Modified);

        connection.queueResult({ rowCount: 1 });
        await expect(db.saveChanges()).resolves.toBe(1);
        expect(connection.statements.at(-1)?.values).toContain('after acceptance');
    });

    it('does not report a durable commit as failed when reconciliation cannot read a value', async () => {
        const connection = new DelayedCommitConnection();
        connection.queueResult({ rowCount: 1 });
        const db = CommitWindowContext.create(connection);
        const record = trackedRecord();
        db.records.attach(record);
        record.name = 'persisted';

        const saving = db.saveChanges();
        await connection.commitStarted;
        record.name = 'after acceptance';
        record.throwOnNameRead = true;
        connection.release();

        await expect(saving).resolves.toBe(1);
        expect(connection.transactionEvents).toEqual(['begin', 'commit']);

        record.throwOnNameRead = false;
        db.changeTracker.detectChanges();
        expect(db.entry(record)?.state).toBe(EntityState.Modified);
    });
});
