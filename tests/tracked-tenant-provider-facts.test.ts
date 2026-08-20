import type { DbContextOptionsBuilder, ModelBuilder } from '../packages/core/src';
import { DbContext, valueConverter } from '../packages/core/src';
import { postgresDialect } from '../packages/postgres/src';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class TenantId {
    constructor(public readonly value: string) {}
}

type FlipMode = 'none' | 'after-entity' | 'after-scope';

const scopeTenant = new TenantId('tenant-one');
let providerEpoch = 'one';
let flipMode: FlipMode = 'none';
let armed = false;

const tenantConverter = valueConverter<TenantId, string>({
    toProvider: value => {
        const providerValue = `${value.value}:${providerEpoch}`;
        const shouldFlip = armed && (
            flipMode === 'after-scope' && value === scopeTenant ||
            flipMode === 'after-entity' && value !== scopeTenant
        );
        if (shouldFlip) {
            armed = false;
            providerEpoch = 'two';
        }
        return providerValue;
    },
    fromProvider: value => new TenantId(value.split(':')[0] ?? value),
});

class TrackedTenantRow {
    public id = '';
    public tenantId!: TenantId;
    public label = '';
    private updatedAtValue?: Date;

    public get updatedAt(): Date | undefined {
        return this.updatedAtValue;
    }

    public set updatedAt(value: Date | undefined) {
        this.updatedAtValue = value;
        if (value !== undefined) armed = true;
    }
}

class TrackedTenantContext extends DbContext {
    public rows = this.set(TrackedTenantRow);

    constructor(private readonly connection: RecordingDatabaseConnection) {
        super();
    }

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(this.connection, {
            provider: postgresDialect.name,
            dialect: postgresDialect,
        }).useTenantScope(() => scopeTenant).useAuditing({
            now: () => new Date('2026-08-10T12:34:56.000Z'),
        });
    }

    protected override model(model: ModelBuilder): void {
        model.entity(TrackedTenantRow, entity => {
            entity.toTable('tracked_tenant_rows');
            entity.hasKey(row => row.id);
            entity.tenantKey(row => row.tenantId);
            entity.audit({ updatedAt: row => row.updatedAt });
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').hasConversion(tenantConverter)
                .isRequired();
            entity.property(row => row.label).hasColumnType('text').isRequired();
            entity.property(row => row.updatedAt).hasColumnName('updated_at')
                .hasColumnType('timestamptz').isRequired();
        });
    }
}

function row(id: string): TrackedTenantRow {
    return Object.assign(new TrackedTenantRow(), {
        id,
        tenantId: new TenantId('tenant-one'),
        label: id,
    });
}

beforeEach(() => {
    providerEpoch = 'one';
    flipMode = 'none';
    armed = false;
});

describe('tracked tenant provider facts', () => {
    it('binds the exact provider value accepted by final validation', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 1 });
        const db = TrackedTenantContext.create(connection);
        flipMode = 'after-scope';
        db.rows.add(row('insert-one'));

        await expect(db.saveChanges()).resolves.toBe(1);

        expect(providerEpoch).toBe('two');
        expect(connection.statements[0]?.values)
            .toContain('tenant-one:one');
        expect(connection.statements[0]?.values)
            .not.toContain('tenant-one:two');
        await db.dispose();
    });

    it('fails before a transaction when provider validation diverges', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = TrackedTenantContext.create(connection);
        flipMode = 'after-entity';
        db.rows.add(row('rejected'));

        await expect(db.saveChanges()).rejects.toThrow(
            'tenant key \'tenantId\' must match the current tenant scope',
        );

        expect(connection.statements).toEqual([]);
        expect(connection.transactionEvents).toEqual([]);
        await db.dispose();
    });

    it('reuses the original provider fact in an update predicate', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 1 });
        const db = TrackedTenantContext.create(connection);
        const entity = row('update-one');
        db.rows.attach(entity);
        entity.label = 'changed';
        flipMode = 'after-scope';

        await expect(db.saveChanges()).resolves.toBe(1);

        expect(connection.statements[0]?.text).toContain('"tenant_id" =');
        expect(connection.statements[0]?.values)
            .toContain('tenant-one:one');
        expect(connection.statements[0]?.values)
            .not.toContain('tenant-one:two');
        await db.dispose();
    });

    it('retains the provider fact inside an explicit transaction', async () => {
        const connection = new RecordingDatabaseConnection();
        connection.queueResult({ rowCount: 1 });
        const db = TrackedTenantContext.create(connection);
        flipMode = 'after-scope';

        await db.transaction(async transaction => {
            transaction.rows.add(row('outer-one'));
            await expect(transaction.saveChanges()).resolves.toBe(1);
        });

        expect(connection.statements[0]?.values)
            .toContain('tenant-one:one');
        expect(connection.transactionEvents).toEqual([
            'begin',
            'savepoint:entitykit_sp_1',
            'release:entitykit_sp_1',
            'commit',
        ]);
        await db.dispose();
    });
});
