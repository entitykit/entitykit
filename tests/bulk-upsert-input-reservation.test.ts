import type {
    DatabaseOperationOptions,
    DatabaseQueryResult,
    DbContextOptionsBuilder,
    ModelBuilder,
    SqlStatement,
} from '../src';
import { DbContext } from '../src';
import { postgresDialect } from '../src/providers/postgres';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

const reservationError =
    'an upsert input cannot become tracked or change tracking state until its transaction finishes';

class ReservedGeneratedRow {
    private storedId = 0;
    public sku = '';
    public label = '';
    public onGenerated?: () => void;

    public get id(): number {
        return this.storedId;
    }

    public set id(value: number) {
        this.storedId = value;
        if (value !== 0) {
            this.onGenerated?.();
        }
    }
}

class ReservedTenantRow {
    public id = '';
    public label = '';
    public tenantId?: string;
}

class ReservationContext extends DbContext {
    public static connection: RecordingDatabaseConnection;
    public generated = this.set(ReservedGeneratedRow);
    public tenantRows = this.set(ReservedTenantRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(ReservationContext.connection, {
            provider: postgresDialect.name,
            dialect: postgresDialect,
        }).useTenantScope(() => 'tenant-one');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(ReservedGeneratedRow, entity => {
            entity.toTable('reserved_generated_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer')
                .isRequired().valueGeneratedOnAdd();
            entity.property(row => row.sku).hasColumnType('text').isRequired();
            entity.property(row => row.label).hasColumnType('text').isRequired();
            entity.hasIndex(row => row.sku).isUnique();
        });
        model.entity(ReservedTenantRow, entity => {
            entity.toTable('reserved_tenant_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.label).hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').isRequired();
            entity.tenantKey(row => row.tenantId);
        });
    }
}

class DelayedUpsertConnection extends RecordingDatabaseConnection {
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
        this.markStarted?.();
        await this.released;
        return super.query<TRow>(statement, options);
    }
}

const generatedOptions = {
    conflictProperties: ['sku'] as const,
    updateProperties: ['label'] as const,
};

function generatedRow(sku = 'sku-one'): ReservedGeneratedRow {
    return Object.assign(new ReservedGeneratedRow(), { sku, label: sku });
}

function tenantRow(): ReservedTenantRow {
    return Object.assign(new ReservedTenantRow(), {
        id: 'tenant-row',
        label: 'tenant row',
    });
}

function open(
    connection: RecordingDatabaseConnection = new RecordingDatabaseConnection(),
): ReservationContext {
    ReservationContext.connection = connection;
    return ReservationContext.create();
}

describe('bulk upsert input reservations', () => {
    it('rejects attach while generated SQL is pending and releases after commit', async () => {
        const connection = new DelayedUpsertConnection();
        connection.queueResult({ rows: [{ id: 41 }], rowCount: 1 });
        const db = open(connection);
        const row = generatedRow();

        const pending = db.generated.upsert([row], generatedOptions);
        await connection.started;
        expect(() => db.generated.attach(row)).toThrow(reservationError);
        connection.release();

        await expect(pending).resolves.toBe(1);
        expect(row.id).toBe(41);
        expect(() => db.generated.attach(row)).not.toThrow();
    });

    it('rejects reentrant add from a generated setter and restores the value', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rows: [{ id: 41 }], rowCount: 1 });
        const db = open(connection);
        const row = generatedRow();
        row.onGenerated = () => {
            db.generated.add(row);
        };

        await expect(db.generated.upsert([row], generatedOptions))
            .rejects.toThrow(reservationError);

        expect(row.id).toBe(0);
        expect(db.entry(row)).toBeUndefined();
        expect(() => db.generated.add(row)).not.toThrow();
    });

    it('holds a generated input until an outer transaction commits', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rows: [{ id: 41 }], rowCount: 1 });
        const db = open(connection);
        const row = generatedRow();

        await db.transaction(async transaction => {
            await transaction.generated.upsert([row], generatedOptions);
            expect(() => transaction.generated.attach(row))
                .toThrow(reservationError);
        });

        expect(row.id).toBe(41);
        expect(() => db.generated.attach(row)).not.toThrow();
    });

    it('holds a generated input through outer rollback and then releases it', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rows: [{ id: 41 }], rowCount: 1 });
        const db = open(connection);
        const row = generatedRow();

        await expect(db.transaction(async transaction => {
            await transaction.generated.upsert([row], generatedOptions);
            expect(() => transaction.generated.attach(row))
                .toThrow(reservationError);
            throw new Error('abort outer');
        })).rejects.toThrow('abort outer');

        expect(row.id).toBe(0);
        expect(() => db.generated.add(row)).not.toThrow();
    });

    it('releases only the input owned by a rolled-back nested transaction', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rows: [{ id: 41 }], rowCount: 1 });
        const db = open(connection);
        const row = generatedRow();

        await db.transaction(async outer => {
            await expect(outer.transaction(async nested => {
                await nested.generated.upsert([row], generatedOptions);
                expect(() => nested.generated.attach(row))
                    .toThrow(reservationError);
                throw new Error('abort nested');
            })).rejects.toThrow('abort nested');

            expect(row.id).toBe(0);
            expect(() => outer.generated.add(row)).not.toThrow();
        });
    });

    it('guards tracker-wide and exact-object mutations for tenant-only input', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 1 });
        const db = open(connection);
        const row = tenantRow();

        await db.transaction(async transaction => {
            await transaction.tenantRows.upsert([row]);
            expect(() => transaction.tenantRows.detach(row))
                .toThrow(reservationError);
            expect(() => {
                transaction.changeTracker.clear();
            })
                .toThrow(reservationError);
            expect(() => {
                transaction.changeTracker.acceptAllChanges();
            })
                .toThrow(reservationError);
        });

        expect(row.tenantId).toBe('tenant-one');
        expect(() => db.tenantRows.attach(row)).not.toThrow();
    });
});
