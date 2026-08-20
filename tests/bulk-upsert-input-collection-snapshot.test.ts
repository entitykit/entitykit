import type {
    DatabaseOperationOptions,
    DatabaseQueryResult,
    DbContextOptionsBuilder,
    ModelBuilder,
    SqlStatement,
} from '../packages/core/src';
import { DbContext, EntityState, valueConverter } from '../packages/core/src';
import { postgresDialect } from '../packages/postgres/src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

let tenantScopeHook: (() => void) | undefined;
let converterHook: (() => void) | undefined;

const labelConverter = valueConverter<string, string>({
    toProvider: value => {
        const hook = converterHook;
        converterHook = undefined;
        hook?.();
        return value;
    },
    fromProvider: value => value,
});

class CollectionSnapshotRow {
    public id = '';
    public onTenant?: () => void;
    public onLabelRead?: () => void;
    private storedTenantId?: string;
    private storedLabel = '';

    public get tenantId(): string | undefined {
        return this.storedTenantId;
    }

    public set tenantId(value: string | undefined) {
        this.storedTenantId = value;
        const hook = this.onTenant;
        this.onTenant = undefined;
        hook?.();
    }

    public get label(): string {
        const hook = this.onLabelRead;
        this.onLabelRead = undefined;
        hook?.();
        return this.storedLabel;
    }

    public set label(value: string) {
        this.storedLabel = value;
    }
}

const oneRowDialect = {
    ...postgresDialect,
    name: 'collection-snapshot-postgres',
    maxStatementParameters: () => 3,
};

class CollectionSnapshotContext extends DbContext {
    public static connection: RecordingDatabaseConnection;
    public rows = this.set(CollectionSnapshotRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(CollectionSnapshotContext.connection, {
            provider: oneRowDialect.name,
            dialect: oneRowDialect,
        }).useTenantScope(() => {
            const hook = tenantScopeHook;
            tenantScopeHook = undefined;
            hook?.();
            return 'tenant-one';
        });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(CollectionSnapshotRow, entity => {
            entity.toTable('collection_snapshot_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').isRequired();
            entity.property(row => row.label).hasColumnType('text')
                .hasConversion(labelConverter).isRequired();
            entity.tenantKey(row => row.tenantId);
        });
    }
}

class DelayedFirstQueryConnection extends RecordingDatabaseConnection {
    private queryCount = 0;
    private markStarted?: () => void;
    private releaseQuery?: () => void;
    public readonly started: Promise<void> = new Promise(resolve => {
        this.markStarted = resolve;
    });
    private readonly released: Promise<void> = new Promise(resolve => {
        this.releaseQuery = resolve;
    });

    public release(): void {
        this.releaseQuery?.();
    }

    public override async query<
        TRow extends Record<string, unknown> = Record<string, unknown>,
    >(
        statement: SqlStatement,
        options?: DatabaseOperationOptions,
    ): Promise<DatabaseQueryResult<TRow>> {
        this.queryCount += 1;
        if (this.queryCount === 1) {
            this.markStarted?.();
            await this.released;
        }
        return super.query<TRow>(statement, options);
    }
}

function row(id: string): CollectionSnapshotRow {
    return Object.assign(new CollectionSnapshotRow(), {
        id,
        label: `Label ${id}`,
    });
}

function open(
    connection: RecordingDatabaseConnection = new RecordingDatabaseConnection(),
): CollectionSnapshotContext {
    CollectionSnapshotContext.connection = connection;
    return CollectionSnapshotContext.create();
}

beforeEach(() => {
    tenantScopeHook = undefined;
    converterHook = undefined;
});

describe('bulk upsert input collection snapshots', () => {
    it('does not resolve policy scope or open a transaction for no inputs', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = open(connection);
        let tenantReads = 0;
        tenantScopeHook = () => {
            tenantReads += 1;
        };

        await expect(db.rows.upsert([])).resolves.toBe(0);

        expect(tenantReads).toBe(0);
        expect(connection.statements).toEqual([]);
        expect(connection.transactionEvents).toEqual([]);
    });

    it('ignores a tracked entity appended by a tenant setter', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 1 });
        const db = open(connection);
        const tracked = Object.assign(row('tracked'), {
            tenantId: 'tenant-one',
        });
        db.rows.add(tracked);
        const first = row('first');
        const inputs = [first];
        first.onTenant = () => inputs.push(tracked);

        await expect(db.rows.upsert(inputs)).resolves.toBe(1);

        expect(inputs).toEqual([first, tracked]);
        expect(connection.statements).toHaveLength(1);
        expect(connection.statements[0]?.values).toEqual([
            'first', 'tenant-one', 'Label first',
        ]);
        expect(db.entry(tracked)?.state).toBe(EntityState.Added);
    });

    it('retains the original list when tenant resolution replaces it', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rowCount: 1 });
        const db = open(connection);
        const first = row('first');
        const second = row('second');
        const replacement = row('replacement');
        const inputs = [first, second];
        tenantScopeHook = () => {
            inputs.splice(0, inputs.length, replacement);
        };

        await expect(db.rows.upsert(inputs)).resolves.toBe(2);

        expect(inputs).toEqual([replacement]);
        expect(connection.statements.map(statement => statement.values))
            .toEqual([
                ['first', 'tenant-one', 'Label first'],
                ['second', 'tenant-one', 'Label second'],
            ]);
    });

    it('ignores a duplicate appended by a mapped getter', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 1 });
        const db = open(connection);
        const first = row('first');
        const inputs = [first];
        first.onLabelRead = () => inputs.push(first);

        await expect(db.rows.upsert(inputs)).resolves.toBe(1);

        expect(inputs).toEqual([first, first]);
        expect(connection.statements).toHaveLength(1);
    });

    it('retains a later input replaced by a value converter', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rowCount: 1 });
        const db = open(connection);
        const first = row('first');
        const second = row('second');
        const replacement = row('replacement');
        const inputs = [first, second];
        converterHook = () => {
            inputs.splice(1, 1, replacement);
        };

        await expect(db.rows.upsert(inputs)).resolves.toBe(2);

        expect(inputs).toEqual([first, replacement]);
        expect(connection.statements.map(statement => statement.values))
            .toEqual([
                ['first', 'tenant-one', 'Label first'],
                ['second', 'tenant-one', 'Label second'],
            ]);
    });

    it('retains every input when the caller mutates the array after execution begins', async () => {
        const connection = new DelayedFirstQueryConnection();
        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rowCount: 1 });
        const db = open(connection);
        const first = row('first');
        const second = row('second');
        const replacement = row('replacement');
        const inputs = [first, second];

        const pending = db.rows.upsert(inputs);
        await connection.started;
        inputs.splice(0, inputs.length, replacement);
        connection.release();

        await expect(pending).resolves.toBe(2);
        expect(connection.statements.map(statement => statement.values))
            .toEqual([
                ['first', 'tenant-one', 'Label first'],
                ['second', 'tenant-one', 'Label second'],
            ]);
    });
});
