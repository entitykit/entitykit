import type {
    DatabaseOperationOptions,
    DatabaseQueryResult,
    DbContextOptionsBuilder,
    ModelBuilder,
    SqlStatement,
} from '../src';
import { ContextConcurrentOperationError, DbContext, EntityState } from '../src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class User {
    public id!: string;
    public name!: string;

    constructor(values: Partial<User>) {
        Object.assign(this, values);
    }
}

class SnapshotContext extends DbContext {
    public users = this.set(User);

    public static open(connection: RecordingDatabaseConnection): SnapshotContext {
        return SnapshotContext.create(connection);
    }

    constructor(private readonly connection: RecordingDatabaseConnection) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(this.connection);
    }

    protected override model(model: ModelBuilder): void {
        model.entity(User, entity => {
            entity.toTable('users');
            entity.hasKey(user => user.id);
            entity.property(user => user.id).hasColumnType('text').isRequired();
            entity.property(user => user.name).hasColumnType('text').isRequired();
        });
    }
}

class DelayedRecordingConnection extends RecordingDatabaseConnection {
    private releaseQuery!: () => void;
    private markQueryStarted!: () => void;
    private readonly queryRelease: Promise<void> = new Promise(resolve => {
        this.releaseQuery = resolve;
    });
    public readonly queryStarted: Promise<void> = new Promise(resolve => {
        this.markQueryStarted = resolve;
    });
    private delayNextQuery = true;

    public release(): void {
        this.releaseQuery();
    }

    public override async query<TRow extends Record<string, unknown> = Record<string, unknown>>(
        statement: SqlStatement,
        options?: DatabaseOperationOptions,
    ): Promise<DatabaseQueryResult<TRow>> {
        if (this.delayNextQuery) {
            this.delayNextQuery = false;
            this.markQueryStarted();
            await this.queryRelease;
        }
        return super.query<TRow>(statement, options);
    }
}

describe('save snapshot acceptance', () => {
    it('keeps a mutation made while SQL is running as a pending change', async () => {
        const connection = new DelayedRecordingConnection();
        connection.queueResult({ rowCount: 1 });
        const db = SnapshotContext.open(connection);
        const user = new User({ id: 'usr_1', name: 'persisted' });
        db.users.add(user);

        const saving = db.saveChanges();
        await connection.queryStarted;
        user.name = 'changed during query';
        connection.release();
        await expect(saving).resolves.toBe(1);

        expect(db.entry(user)?.state).toBe(EntityState.Modified);
        expect(db.entry(user)?.originalValues.name).toBe('persisted');

        connection.queueResult({ rowCount: 1 });
        await expect(db.saveChanges()).resolves.toBe(1);
        expect(connection.statements.at(-1)?.values).toContain('changed during query');
        expect(db.entry(user)?.state).toBe(EntityState.Unchanged);
    });

    it('rejects structural tracker mutations while SQL is running', async () => {
        const connection = new DelayedRecordingConnection();
        connection.queueResult({ rowCount: 1 });
        const db = SnapshotContext.open(connection);
        const first = new User({ id: 'usr_1', name: 'First' });
        const late = new User({ id: 'usr_2', name: 'Late' });
        db.users.add(first);

        const saving = db.saveChanges();
        await connection.queryStarted;
        expect(() => db.users.add(late)).toThrow(ContextConcurrentOperationError);
        expect(() => db.users.detach(first)).toThrow(ContextConcurrentOperationError);
        expect(() => {
            db.changeTracker.clear();
        }).toThrow(ContextConcurrentOperationError);
        expect(() => {
            const entry = db.entry(first);
            if (entry) {
                (entry as { state: EntityState }).state = EntityState.Deleted;
            }
        }).toThrow(TypeError);
        connection.release();
        await expect(saving).resolves.toBe(1);

        expect(db.entry(first)?.state).toBe(EntityState.Unchanged);
        expect(db.entry(late)).toBeUndefined();
    });
});
