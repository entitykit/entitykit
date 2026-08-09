import type {
    DatabaseOperationOptions,
    DatabaseQueryResult,
    DbContextOptionsBuilder,
    ModelBuilder,
    SqlStatement,
} from '../src';
import { DbContext, valueConverter } from '../src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class FlatUpsertRow {
    public id = '';
    public tenantId?: string;
    public name = '';
}

class FlatUpsertContext extends DbContext {
    public static connection: RecordingDatabaseConnection;
    public rows = this.set(FlatUpsertRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(FlatUpsertContext.connection)
            .useTenantScope(() => 'tenant-one');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(FlatUpsertRow, entity => {
            entity.toTable('flat_upsert_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
            entity.tenantKey(row => row.tenantId);
        });
    }
}

class TenantId {
    constructor(public readonly value: string) {}
}

const tenantIdConverter = valueConverter<TenantId, string>({
    toProvider: value => value.value,
    fromProvider: value => new TenantId(value),
});

class NestedTenantScope {
    public tenantId?: TenantId;
}

class NestedUpsertRow {
    public id = '';
    public name = '';
    public scope: NestedTenantScope | null = null;
}

class NestedUpsertContext extends DbContext {
    public static connection: RecordingDatabaseConnection;
    public rows = this.set(NestedUpsertRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(NestedUpsertContext.connection)
            .useTenantScope(() => new TenantId('tenant-one'));
    }

    protected override model(model: ModelBuilder): void {
        model.entity(NestedUpsertRow, entity => {
            entity.toTable('nested_upsert_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.name).hasColumnType('text').isRequired();
            entity.tenantKey(row => row.scope.tenantId);
            entity.complexProperty(
                row => row.scope,
                { constructor: NestedTenantScope },
                scope => scope.property(value => value.tenantId)
                    .hasColumnName('tenant_id').hasColumnType('text')
                    .hasConversion(tenantIdConverter),
            );
        });
    }
}

class DelayedFailureConnection extends RecordingDatabaseConnection {
    private releaseQuery!: () => void;
    private readonly released: Promise<void> = new Promise(resolve => {
        this.releaseQuery = resolve;
    });
    private markStarted!: () => void;
    public readonly started: Promise<void> = new Promise(resolve => {
        this.markStarted = resolve;
    });

    constructor() {
        super();
        this.queueError(new Error('provider failed'));
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
        this.markStarted();
        await this.released;
        return super.query<TRow>(statement, options);
    }
}

function flatRow(): FlatUpsertRow {
    return Object.assign(new FlatUpsertRow(), {
        id: 'row-one',
        name: 'row',
    });
}

describe('upsert tenant stamp failure boundaries', () => {
    it('restores a stamp when transaction begin or commit fails', async () => {
        const beginConnection = new RecordingDatabaseConnection();
        beginConnection.failNextTransactionBegin(new Error('begin failed'));
        FlatUpsertContext.connection = beginConnection;
        const beginDb = FlatUpsertContext.create();
        const beginRow = flatRow();

        await expect(beginDb.rows.upsert([beginRow])).rejects.toThrow(
            'begin failed',
        );
        expect(beginRow.tenantId).toBeUndefined();

        const commitConnection = new RecordingDatabaseConnection();
        commitConnection.queueResult({ rowCount: 1 });
        commitConnection.failNextTransactionCommit(new Error('commit failed'));
        FlatUpsertContext.connection = commitConnection;
        const commitDb = FlatUpsertContext.create();
        const commitRow = flatRow();

        await expect(commitDb.rows.upsert([commitRow])).rejects.toThrow(
            'commit failed',
        );
        expect(commitRow.tenantId).toBeUndefined();
    });

    it('preserves a caller replacement made before provider failure', async () => {
        const connection = new DelayedFailureConnection();
        FlatUpsertContext.connection = connection;
        const db = FlatUpsertContext.create();
        const row = flatRow();

        const pending = db.rows.upsert([row]);
        await connection.started;
        expect(row.tenantId).toBe('tenant-one');
        row.tenantId = 'caller-replacement';
        connection.release();

        await expect(pending).rejects.toThrow();
        expect(row.tenantId).toBe('caller-replacement');
    });

    it('removes a pristine converted tenant ancestor after later validation', async () => {
        NestedUpsertContext.connection = new RecordingDatabaseConnection();
        const db = NestedUpsertContext.create();
        const first = Object.assign(new NestedUpsertRow(), {
            id: 'first',
            name: 'first',
        });
        const second = Object.assign(new NestedUpsertRow(), {
            id: 'second',
            name: 'second',
            scope: Object.assign(new NestedTenantScope(), {
                tenantId: new TenantId('tenant-two'),
            }),
        });

        await expect(db.rows.upsert([first, second])).rejects.toThrow(
            /tenant key 'scope.tenantId' must match/,
        );

        expect(first.scope).toBeNull();
        expect(NestedUpsertContext.connection.statements).toEqual([]);
    });
});
