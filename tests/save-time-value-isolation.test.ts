import type {
    DatabaseOperationOptions,
    DatabaseQueryResult,
    DbContextOptionsBuilder,
    ModelBuilder,
    SqlStatement,
} from '../packages/core/src';
import { DbContext, EntityState } from '../packages/core/src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

const originalTime = new Date('2026-01-01T00:00:00.000Z');
const saveTime = new Date('2026-08-05T12:00:00.000Z');
const changedTime = new Date('2026-09-01T00:00:00.000Z');

class MutablePolicyRow {
    public id = '';
    public name = '';
    public createdAt = originalTime;
    public updatedAt = originalTime;
    public deletedAt: Date | null = null;
}

class MutablePolicyContext extends DbContext {
    public rows = this.set(MutablePolicyRow);

    constructor(private readonly connection: RecordingDatabaseConnection) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(this.connection).useAuditing({ now: () => saveTime });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(MutablePolicyRow, entity => {
            entity.toTable('mutable_policy_rows');
            entity.hasKey(row => row.id);
            entity.audit({
                createdAt: row => row.createdAt,
                updatedAt: row => row.updatedAt,
            });
            entity.softDelete(row => row.deletedAt);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
            entity.property(row => row.createdAt).hasColumnName('created_at')
                .hasColumnType('timestamptz').isRequired();
            entity.property(row => row.updatedAt).hasColumnName('updated_at')
                .hasColumnType('timestamptz').isRequired();
            entity.property(row => row.deletedAt).hasColumnName('deleted_at')
                .hasColumnType('timestamptz');
        });
    }
}

class DelayedQueryConnection extends RecordingDatabaseConnection {
    private releaseQuery!: () => void;
    private markStarted!: () => void;
    private queryCount = 0;
    public readonly queryStarted: Promise<void> = new Promise(resolve => {
        this.markStarted = resolve;
    });
    private readonly released: Promise<void> = new Promise(resolve => {
        this.releaseQuery = resolve;
    });

    public release(): void {
        this.releaseQuery();
    }

    public override async query<TRow extends Record<string, unknown>>(
        statement: SqlStatement,
        options?: DatabaseOperationOptions,
    ): Promise<DatabaseQueryResult<TRow>> {
        this.queryCount += 1;
        if (this.queryCount === 2) {
            this.markStarted();
            await this.released;
        }
        return super.query<TRow>(statement, options);
    }
}

function existing(id: string): MutablePolicyRow {
    return Object.assign(new MutablePolicyRow(), { id, name: 'before' });
}

describe('save-time mutable value isolation', () => {
    it('keeps equal audit instants isolated from live in-place mutation', async () => {
        const connection = new DelayedQueryConnection();
        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rowCount: 1 });
        const db = MutablePolicyContext.create(connection);
        const first = existing('first');
        const second = existing('second');
        db.rows.attach(first);
        db.rows.attach(second);
        first.name = 'after';
        second.name = 'after';

        const saving = db.saveChanges();
        await connection.queryStarted;
        expect(first.updatedAt).toEqual(saveTime);
        expect(second.updatedAt).toEqual(saveTime);
        expect(first.updatedAt).not.toBe(second.updatedAt);
        first.updatedAt.setTime(changedTime.getTime());
        connection.release();
        await expect(saving).resolves.toBe(2);

        expect(second.updatedAt).toEqual(saveTime);
        expect(db.entry(first)?.originalValues.updatedAt).toEqual(saveTime);
        expect(db.entry(second)?.originalValues.updatedAt).toEqual(saveTime);
        expect(db.entry(first)?.state).toBe(EntityState.Modified);
        expect(db.entry(second)?.state).toBe(EntityState.Unchanged);
        const timestamps = connection.statements.flatMap(statement =>
            statement.values.filter(value => value instanceof Date));
        expect(timestamps.every(value => value.getTime() === saveTime.getTime()))
            .toBe(true);
    });

    it('keeps a soft-delete fact isolated from live in-place mutation', async () => {
        const connection = new DelayedQueryConnection();
        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rowCount: 1 });
        const db = MutablePolicyContext.create(connection);
        const removed = existing('removed');
        const added = Object.assign(new MutablePolicyRow(), {
            id: 'added',
            name: 'added',
        });
        db.rows.attach(removed);
        db.rows.remove(removed);
        db.rows.add(added);

        const saving = db.saveChanges();
        await connection.queryStarted;
        expect(removed.deletedAt).toEqual(saveTime);
        removed.deletedAt?.setTime(changedTime.getTime());
        connection.release();
        await expect(saving).resolves.toBe(2);

        expect(db.entry(removed)?.originalValues.deletedAt).toEqual(saveTime);
        expect(db.entry(removed)?.state).toBe(EntityState.Modified);
    });
});
