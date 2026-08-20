import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext } from '../packages/core/src';
import { postgresDialect } from '../packages/postgres/src';
import { sqliteProviderServices } from '../packages/sqlite/src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class GeneratedDetails {
    public createdAt?: Date;
}

class TransactionUpsertRow {
    private storedId = 0;
    public sku = '';
    public label = '';
    public tenantId?: string;
    public details: GeneratedDetails | null = null;

    constructor(private readonly restorations?: string[]) {}

    public get id(): number {
        return this.storedId;
    }

    public set id(value: number) {
        this.storedId = value;
        if (value === 0) {
            this.restorations?.push(this.sku);
        }
    }
}

class TransactionUpsertContext extends DbContext {
    public rows = this.set(TransactionUpsertRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useProvider(sqliteProviderServices, ':memory:')
            .useTenantScope(() => 'tenant-one');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(TransactionUpsertRow, entity => {
            entity.toTable('transaction_upsert_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer')
                .isRequired().useSqliteRowId({ preventReuse: true });
            entity.property(row => row.sku).hasColumnType('text').isRequired();
            entity.property(row => row.label).hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').isRequired();
            entity.tenantKey(row => row.tenantId);
            entity.complexProperty(
                row => row.details,
                { constructor: GeneratedDetails },
                details => details.property(value => value.createdAt)
                    .hasColumnName('created_at').hasColumnType('timestamp')
                    .isOptional().hasDefaultSql('current_timestamp')
                    .valueGeneratedOnAdd(),
            );
            entity.hasIndex(row => row.sku).isUnique();
        });
    }
}

class CommitFailureRow {
    public id = 0;
    public sku = '';
    public label = '';
    public tenantId?: string;
    public createdAt?: Date;
}

class CommitFailureContext extends DbContext {
    public static connection: RecordingDatabaseConnection;
    public rows = this.set(CommitFailureRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(CommitFailureContext.connection, {
            provider: postgresDialect.name,
            dialect: postgresDialect,
        }).useTenantScope(() => 'tenant-one');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(CommitFailureRow, entity => {
            entity.toTable('commit_failure_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer')
                .isRequired().valueGeneratedOnAdd();
            entity.property(row => row.sku).hasColumnType('text').isRequired();
            entity.property(row => row.label).hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').isRequired();
            entity.property(row => row.createdAt).hasColumnName('created_at')
                .hasColumnType('timestamp').isOptional()
                .valueGeneratedOnAdd();
            entity.tenantKey(row => row.tenantId);
            entity.hasIndex(row => row.sku).isUnique();
        });
    }
}

const upsertOptions = {
    conflictProperties: ['sku'] as const,
    updateProperties: ['label'] as const,
};

function row(sku: string, restorations?: string[]): TransactionUpsertRow {
    return Object.assign(new TransactionUpsertRow(restorations), {
        sku,
        label: `label-${sku}`,
    });
}

async function open(): Promise<TransactionUpsertContext> {
    const db = TransactionUpsertContext.create();
    await db.database.connection.query({
        text: db.database.createScript(),
        values: [],
    });
    return db;
}

describe('bulk upsert transaction state', () => {
    it('restores generated values complex ancestors and tenant stamps on outer rollback', async () => {
        const db = await open();
        const incoming = row('outer-rollback');

        await expect(db.transaction(async transaction => {
            await expect(transaction.rows.upsert([incoming], upsertOptions))
                .resolves.toBe(1);
            expect(incoming.id).toBeGreaterThan(0);
            expect(incoming.tenantId).toBe('tenant-one');
            expect(incoming.details?.createdAt).toBeInstanceOf(Date);
            throw new Error('abort outer transaction');
        })).rejects.toThrow('abort outer transaction');

        expect(incoming.id).toBe(0);
        expect(incoming.tenantId).toBeUndefined();
        expect(incoming.details).toBeNull();
        expect(await db.rows.count()).toBe(0);
        await db.dispose();
    });

    it('keeps generated values and tenant stamps after outer commit', async () => {
        const db = await open();
        const incoming = row('outer-commit');

        await db.transaction(async transaction => {
            await transaction.rows.upsert([incoming], upsertOptions);
        });

        expect(incoming.id).toBeGreaterThan(0);
        expect(incoming.tenantId).toBe('tenant-one');
        expect(incoming.details?.createdAt).toBeInstanceOf(Date);
        expect(await db.rows.count()).toBe(1);
        await db.dispose();
    });

    it('restores only a caught nested transaction while the outer scope commits', async () => {
        const db = await open();
        const incoming = row('nested-rollback');

        await db.transaction(async outer => {
            await expect(outer.transaction(async nested => {
                await nested.rows.upsert([incoming], upsertOptions);
                throw new Error('abort nested transaction');
            })).rejects.toThrow('abort nested transaction');

            expect(incoming.id).toBe(0);
            expect(incoming.tenantId).toBeUndefined();
            expect(incoming.details).toBeNull();
            expect(await outer.rows.count()).toBe(0);
        });

        expect(await db.rows.count()).toBe(0);
        await db.dispose();
    });

    it('restores multiple successful upserts in reverse registration order', async () => {
        const db = await open();
        const restorations: string[] = [];
        const first = row('first', restorations);
        const second = row('second', restorations);

        await expect(db.transaction(async transaction => {
            await transaction.rows.upsert([first], upsertOptions);
            await transaction.rows.upsert([second], upsertOptions);
            throw new Error('abort both upserts');
        })).rejects.toThrow('abort both upserts');

        expect(restorations).toEqual(['second', 'first']);
        expect(first.id).toBe(0);
        expect(second.id).toBe(0);
        expect(first.tenantId).toBeUndefined();
        expect(second.tenantId).toBeUndefined();
        expect(await db.rows.count()).toBe(0);
        await db.dispose();
    });

    it('restores generated values and tenant stamps after outer commit failure', async () => {
        const connection = new RecordingDatabaseConnection();
        CommitFailureContext.connection = connection;
        const db = CommitFailureContext.create();
        const createdAt = new Date('2026-08-10T12:00:00.000Z');
        const incoming = Object.assign(new CommitFailureRow(), {
            sku: 'commit-failure',
            label: 'commit-failure',
        });
        connection.queueResult({
            rows: [{ id: 71, created_at: createdAt }],
            rowCount: 1,
        });
        connection.failNextTransactionCommit(new Error('commit failed'));

        await expect(db.transaction(async transaction => {
            await transaction.rows.upsert([incoming], upsertOptions);
        })).rejects.toThrow('commit failed');

        expect(incoming.id).toBe(0);
        expect(incoming.tenantId).toBeUndefined();
        expect(incoming.createdAt).toBeUndefined();
        expect(connection.transactionEvents).toEqual([
            'begin',
            'savepoint:entitykit_sp_1',
            'release:entitykit_sp_1',
            'rollback',
        ]);
    });
});
