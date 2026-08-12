import type {
    DatabaseOperationOptions,
    DatabaseQueryResult,
    DbContextOptionsBuilder,
    ModelBuilder,
    SqlStatement,
} from '../src';
import { DbContext, EntityState } from '../src';
import { postgresDialect } from '../src/providers/postgres';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class RollbackParent {
    public id!: number;
    public name = '';
}

class RollbackChild {
    public id = '';
    public parentId!: number;
    public parent!: RollbackParent;
}

class RollbackContext extends DbContext {
    public parents = this.set(RollbackParent);
    public children = this.set(RollbackChild);

    constructor(private readonly connection: RecordingDatabaseConnection) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(this.connection, {
            provider: postgresDialect.name,
            dialect: postgresDialect,
        });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(RollbackParent, entity => {
            entity.toTable('rollback_parents');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer')
                .isRequired().valueGeneratedOnAdd();
            entity.property(row => row.name).hasColumnType('text').isRequired();
        });
        model.entity(RollbackChild, entity => {
            entity.toTable('rollback_children');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.parentId).hasColumnName('parent_id')
                .hasColumnType('integer').isRequired();
            entity.hasOne(RollbackParent, row => row.parent).withMany()
                .hasForeignKey(row => row.parentId);
        });
    }
}

class DelayedChildConnection extends RecordingDatabaseConnection {
    private releaseQuery!: () => void;
    private markStarted!: () => void;
    private queryCount = 0;
    private readonly released: Promise<void>;
    public readonly childQueryStarted: Promise<void>;

    constructor() {
        super();
        this.released = new Promise(resolve => {
            this.releaseQuery = resolve;
        });
        this.childQueryStarted = new Promise(resolve => {
            this.markStarted = resolve;
        });
    }

    public release(): void {
        this.releaseQuery();
    }

    public override async query<
        TRow extends Record<string, unknown> = Record<string, unknown>,
    >(
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

function graph(connection: RecordingDatabaseConnection): {
    readonly db: RollbackContext;
    readonly parent: RollbackParent;
    readonly child: RollbackChild;
} {
    const db = RollbackContext.create(connection);
    const parent = Object.assign(new RollbackParent(), { name: 'parent' });
    const child = Object.assign(new RollbackChild(), {
        id: 'child', parent,
    });
    db.children.add(child);
    db.parents.add(parent);
    return { db, parent, child };
}

describe('generated foreign-key rollback', () => {
    it('preserves a newer FK edit when a later statement fails', async () => {
        const connection = new DelayedChildConnection();
        const { db, parent, child } = graph(connection);
        connection.queueResult({ rows: [{ id: 71 }], rowCount: 1 });
        connection.queueError(new Error('child insert failed'));

        const saving = db.saveChanges();
        await connection.childQueryStarted;
        child.parentId = 999;
        connection.release();

        await expect(saving).rejects.toThrow('child insert failed');
        expect(parent.id).toBeUndefined();
        expect(child.parentId).toBe(999);
        expect(db.entry(child)?.state).toBe(EntityState.Added);
    });

    it('preserves a newer FK edit after an outer rollback', async () => {
        const connection = new RecordingDatabaseConnection();
        const { db, parent, child } = graph(connection);
        connection.queueResult({ rows: [{ id: 71 }], rowCount: 1 });
        connection.queueResult({ rowCount: 1 });

        await expect(db.transaction(async transaction => {
            await transaction.saveChanges();
            expect(parent.id).toBe(71);
            expect(child.parentId).toBe(71);
            child.parentId = 999;
            throw new Error('abort outer transaction');
        })).rejects.toThrow('abort outer transaction');

        expect(parent.id).toBeUndefined();
        expect(child.parentId).toBe(999);
        expect(db.entry(child)?.state).toBe(EntityState.Added);
    });
});
