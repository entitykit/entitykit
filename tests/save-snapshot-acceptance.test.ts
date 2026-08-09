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

class Department {
    public id!: string;
    public members: Member[] = [];
}

class Member {
    public id!: string;
    public departmentId!: string;
    public department?: Department;
}

class SnapshotContext extends DbContext {
    public users = this.set(User);
    public departments = this.set(Department);
    public members = this.set(Member);

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
        model.entity(Department, entity => {
            entity.toTable('departments');
            entity.hasKey(department => department.id);
            entity.property(department => department.id)
                .hasColumnType('text').isRequired();
        });
        model.entity(Member, entity => {
            entity.toTable('members');
            entity.hasKey(member => member.id);
            entity.property(member => member.id)
                .hasColumnType('text').isRequired();
            entity.property(member => member.departmentId)
                .hasColumnName('department_id').hasColumnType('text')
                .isRequired();
            entity.hasOne(Department, member => member.department)
                .withMany(department => department.members)
                .hasForeignKey(member => member.departmentId);
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
        expect(() => {
            db.changeTracker.detectChanges();
        }).toThrow(
            'detectChanges() cannot run while saveChanges() SQL is executing. Await the save first.',
        );
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

    it('reconciles a reverted scalar after rejecting in-flight detection', async () => {
        const connection = new DelayedRecordingConnection();
        connection.queueResult({ rowCount: 1 });
        const db = SnapshotContext.open(connection);
        const user = new User({ id: 'usr_1', name: 'original' });
        db.users.attach(user);
        user.name = 'database-value';

        const saving = db.saveChanges();
        await connection.queryStarted;
        user.name = 'original';
        expect(() => {
            db.changeTracker.detectChanges();
        }).toThrow(
            ContextConcurrentOperationError,
        );
        expect(() => {
            db.changeTracker.debugView();
        }).toThrow(
            'debugView() cannot run while saveChanges() SQL is executing. Await the save first.',
        );
        connection.release();
        await expect(saving).resolves.toBe(1);

        expect(db.entry(user)?.originalValues.name).toBe('database-value');
        expect(db.entry(user)?.state).toBe(EntityState.Modified);

        connection.queueResult({ rowCount: 1 });
        await expect(db.saveChanges()).resolves.toBe(1);
        expect(connection.statements.at(-1)?.values).toContain('original');
        expect(db.entry(user)?.state).toBe(EntityState.Unchanged);
    });

    it('blocks relationship fix-up until the active statement completes', async () => {
        const connection = new DelayedRecordingConnection();
        connection.queueResult({ rowCount: 1 });
        const db = SnapshotContext.open(connection);
        const first = Object.assign(new Department(), {
            id: 'department-one',
        });
        const second = Object.assign(new Department(), {
            id: 'department-two',
        });
        const member = Object.assign(new Member(), {
            id: 'member-one',
            departmentId: first.id,
            department: first,
        });
        first.members = [member];
        db.departments.attach(first);
        db.departments.attach(second);
        db.members.attach(member);
        const user = new User({ id: 'usr_1', name: 'before' });
        db.users.attach(user);
        user.name = 'saving';

        const saving = db.saveChanges();
        await connection.queryStarted;
        member.department = second;
        first.members = [];
        second.members = [member];
        expect(() => {
            db.changeTracker.detectChanges();
        }).toThrow(
            ContextConcurrentOperationError,
        );
        expect(member.departmentId).toBe('department-one');
        connection.release();
        await expect(saving).resolves.toBe(1);

        expect(() => {
            db.changeTracker.detectChanges();
        }).not.toThrow();
        expect(member.departmentId).toBe('department-two');
        expect(db.entry(member)?.state).toBe(EntityState.Modified);
    });

    it('allows detection between completed saves in an explicit transaction', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rowCount: 1 });
        const db = SnapshotContext.open(connection);
        const user = new User({ id: 'usr_1', name: 'before' });
        db.users.attach(user);
        user.name = 'first save';

        await db.transaction(async transaction => {
            await expect(transaction.saveChanges()).resolves.toBe(1);
            user.name = 'second save';
            expect(() => {
                transaction.changeTracker.detectChanges();
            }).not.toThrow();
            expect(transaction.entry(user)?.state).toBe(EntityState.Modified);
            await expect(transaction.saveChanges()).resolves.toBe(1);
        });

        expect(connection.transactionEvents).toEqual([
            'begin',
            'savepoint:entitykit_sp_1',
            'release:entitykit_sp_1',
            'savepoint:entitykit_sp_1',
            'release:entitykit_sp_1',
            'commit',
        ]);
        expect(db.entry(user)?.originalValues.name).toBe('second save');
        expect(db.entry(user)?.state).toBe(EntityState.Unchanged);
    });
});
