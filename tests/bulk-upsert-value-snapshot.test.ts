import type {
    DatabaseOperationOptions,
    DatabaseQueryResult,
    DbContextOptionsBuilder,
    ModelBuilder,
    SqlStatement,
} from '../packages/core/src';
import { DbContext } from '../packages/core/src';
import { postgresDialect } from '../packages/postgres/src';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class UnstableTenantRow {
    public id = '';
    public name = '';
    public tenantReads = 0;

    public get tenantId(): string {
        this.tenantReads += 1;
        return this.tenantReads <= 2 ? 'tenant-one' : 'tenant-two';
    }
}

class UnstableTenantContext extends DbContext {
    public rows = this.set(UnstableTenantRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:')
            .useTenantScope(() => 'tenant-one');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(UnstableTenantRow, entity => {
            entity.toTable('unstable_tenant_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
            entity.tenantKey(row => row.tenantId);
        });
    }
}

class BatchSnapshotRow {
    public id = '';
    public tenantId = 'tenant-one';
    public name = '';
}

const oneRowDialect = {
    ...postgresDialect,
    name: 'snapshot-postgres',
    maxStatementParameters: () => 3,
};

class DelayedFirstQueryConnection extends RecordingDatabaseConnection {
    private releaseFirst!: () => void;
    private markFirstStarted!: () => void;
    private readonly released: Promise<void> = new Promise(resolve => {
        this.releaseFirst = resolve;
    });
    public readonly firstStarted: Promise<void> = new Promise(resolve => {
        this.markFirstStarted = resolve;
    });
    public readonly querySignals: Array<AbortSignal | undefined> = [];
    private queryCount = 0;

    public release(): void {
        this.releaseFirst();
    }

    public override async query<
        TRow extends Record<string, unknown> = Record<string, unknown>,
    >(
        statement: SqlStatement,
        options?: DatabaseOperationOptions,
    ): Promise<DatabaseQueryResult<TRow>> {
        this.queryCount += 1;
        this.querySignals.push(options?.signal);
        if (this.queryCount === 1) {
            this.markFirstStarted();
            await this.released;
        }
        return super.query<TRow>(statement, options);
    }
}

class BatchSnapshotContext extends DbContext {
    public rows = this.set(BatchSnapshotRow);

    constructor(private readonly connection: RecordingDatabaseConnection) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(this.connection, {
            provider: oneRowDialect.name,
            dialect: oneRowDialect,
        }).useTenantScope(() => 'tenant-one');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(BatchSnapshotRow, entity => {
            entity.toTable('batch_snapshot_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
            entity.tenantKey(row => row.tenantId);
        });
    }
}

describe('bulk upsert value snapshots', () => {
    it('binds the tenant value captured after scope validation', async () => {
        const db = UnstableTenantContext.create();
        await db.database.connection.query({
            text: db.database.createScript(),
            values: [],
        });
        const row = Object.assign(new UnstableTenantRow(), {
            id: 'row-one',
            name: 'row',
        });

        await expect(db.rows.upsert([row])).resolves.toBe(1);

        const stored = await db.database.connection.query<{
            tenant_id: string;
        }>({
            text: 'select tenant_id from unstable_tenant_rows',
            values: [],
        });
        expect(stored.rows).toEqual([{ tenant_id: 'tenant-one' }]);
        expect(row.tenantReads).toBe(2);
        await db.dispose();
    });

    it('captures later batches before awaiting the first statement', async () => {
        const connection = new DelayedFirstQueryConnection();
        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rowCount: 1 });
        const db = BatchSnapshotContext.create(connection);
        const first = Object.assign(new BatchSnapshotRow(), {
            id: 'first',
            name: 'first-before',
        });
        const second = Object.assign(new BatchSnapshotRow(), {
            id: 'second',
            name: 'second-before',
        });

        const pending = db.rows.upsert([first, second]);
        await connection.firstStarted;
        second.tenantId = 'tenant-two';
        second.name = 'second-after';
        connection.release();

        await expect(pending).resolves.toBe(2);
        expect(connection.statements).toHaveLength(2);
        expect(connection.statements[1].values).toEqual([
            'second',
            'tenant-one',
            'second-before',
        ]);
        expect(connection.transactionEvents).toEqual(['begin', 'commit']);
    });

    it('owns option arrays across batches while retaining the abort signal', async () => {
        const connection = new DelayedFirstQueryConnection();
        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rowCount: 1 });
        const db = BatchSnapshotContext.create(connection);
        const conflictProperties: Array<keyof BatchSnapshotRow> = ['id'];
        const updateProperties: Array<keyof BatchSnapshotRow> = ['name'];
        const controller = new AbortController();

        const pending = db.rows.upsert([
            Object.assign(new BatchSnapshotRow(), { id: 'first', name: 'one' }),
            Object.assign(new BatchSnapshotRow(), { id: 'second', name: 'two' }),
        ], {
            conflictProperties,
            updateProperties,
            signal: controller.signal,
        });
        await connection.firstStarted;
        conflictProperties[0] = 'name';
        updateProperties[0] = 'id';
        connection.release();

        await expect(pending).resolves.toBe(2);
        expect(connection.statements[1]?.text)
            .toBe(connection.statements[0]?.text);
        expect(connection.querySignals).toEqual([
            controller.signal,
            controller.signal,
        ]);
    });
});
