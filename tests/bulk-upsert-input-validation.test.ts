import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext, EntityState } from '../packages/core/src';
import { postgresDialect } from '../packages/postgres/src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class GuardedUpsertRow {
    public id = 0;
    public sku = '';
    public label = '';
    public tenantId?: string;
}

class GuardedUpsertContext extends DbContext {
    public static connection: RecordingDatabaseConnection;
    public rows = this.set(GuardedUpsertRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(GuardedUpsertContext.connection, {
            provider: postgresDialect.name,
            dialect: postgresDialect,
        }).useTenantScope(() => 'tenant-one');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(GuardedUpsertRow, entity => {
            entity.toTable('guarded_upsert_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('integer')
                .isRequired().valueGeneratedOnAdd();
            entity.property(row => row.sku).hasColumnType('text').isRequired();
            entity.property(row => row.label).hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').isRequired();
            entity.tenantKey(row => row.tenantId);
            entity.hasIndex(row => row.sku).isUnique();
        });
    }
}

const options = {
    conflictProperties: ['sku'] as const,
    updateProperties: ['label'] as const,
};

function open(): {
    readonly db: GuardedUpsertContext;
    readonly connection: RecordingDatabaseConnection;
} {
    const connection = new RecordingDatabaseConnection();
    GuardedUpsertContext.connection = connection;
    return { db: GuardedUpsertContext.create(), connection };
}

function row(): GuardedUpsertRow {
    return Object.assign(new GuardedUpsertRow(), {
        sku: 'sku-one',
        label: 'label-one',
    });
}

describe('bulk upsert input validation', () => {
    it('rejects a tracked generated entity before mutation or SQL', async () => {
        const { db, connection } = open();
        const incoming = row();
        const entry = db.rows.add(incoming);
        incoming.tenantId = undefined;

        await expect(db.rows.upsert([incoming], options)).rejects.toThrow(
            'Upsert input \'GuardedUpsertRow\' is already tracked. ' +
            'Use saveChanges() for tracked entities or detach it before upsert.',
        );

        expect(incoming.id).toBe(0);
        expect(incoming.tenantId).toBeUndefined();
        expect(entry.state).toBe(EntityState.Added);
        expect(connection.statements).toEqual([]);
        expect(connection.transactionEvents).toEqual([]);
    });

    it('rejects a duplicate reference before tenant stamping or SQL', async () => {
        const { db, connection } = open();
        const incoming = row();

        await expect(db.rows.upsert([incoming, incoming], options))
            .rejects.toThrow(
                'Upsert input \'GuardedUpsertRow\' appears more than once. ' +
                'Each input object must be unique.',
            );

        expect(incoming.id).toBe(0);
        expect(incoming.tenantId).toBeUndefined();
        expect(db.entry(incoming)).toBeUndefined();
        expect(connection.statements).toEqual([]);
        expect(connection.transactionEvents).toEqual([]);
    });

    it('allows an untracked input when another object represents the same row', async () => {
        const { db, connection } = open();
        const tracked = Object.assign(row(), { id: 42 });
        const incoming = row();
        db.rows.attach(tracked);
        connection.queueResult({ rows: [{ id: 42 }], rowCount: 1 });

        await expect(db.rows.upsert([incoming], options)).resolves.toBe(1);

        expect(incoming.id).toBe(42);
        expect(db.entry(incoming)).toBeUndefined();
        expect(db.entry(tracked)?.state).toBe(EntityState.Unchanged);
        expect(connection.statements).toHaveLength(1);
    });
});
