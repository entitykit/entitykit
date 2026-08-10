import type {
    DatabaseOperationOptions,
    DatabaseQueryResult,
    DbContextOptionsBuilder,
    ModelBuilder,
    SqlStatement,
} from '../src';
import { DbContext, valueConverter } from '../src';
import { postgresDialect } from '../src/providers/postgres';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

let providerEpoch = 'one';
let flipTenantAfterReturn = false;
let labelConversions = 0;

const tenantConverter = valueConverter<string, string>({
    toProvider: value => {
        const provider = `${value}:${providerEpoch}`;
        if (flipTenantAfterReturn) {
            flipTenantAfterReturn = false;
            providerEpoch = 'two';
        }
        return provider;
    },
    fromProvider: value => value.split(':')[0] ?? value,
});

const labelConverter = valueConverter<string, string>({
    toProvider: value => {
        labelConversions += 1;
        return `${value}:${providerEpoch}`;
    },
    fromProvider: value => value.split(':')[0] ?? value,
});

class ProviderSnapshotRow {
    public id = '';
    public tenantId = 'tenant-one';
    public label = '';
}

const oneRowDialect = {
    ...postgresDialect,
    name: 'provider-snapshot-postgres',
    maxStatementParameters: () => 3,
};

class EpochChangingConnection extends RecordingDatabaseConnection {
    private queryCount = 0;

    public override async query<
        TRow extends Record<string, unknown> = Record<string, unknown>,
    >(
        statement: SqlStatement,
        options?: DatabaseOperationOptions,
    ): Promise<DatabaseQueryResult<TRow>> {
        this.queryCount += 1;
        const result = await super.query<TRow>(statement, options);
        if (this.queryCount === 1) providerEpoch = 'two';
        return result;
    }
}

class ProviderSnapshotContext extends DbContext {
    public static connection: RecordingDatabaseConnection;
    public rows = this.set(ProviderSnapshotRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(ProviderSnapshotContext.connection, {
            provider: oneRowDialect.name,
            dialect: oneRowDialect,
        }).useTenantScope(() => 'tenant-one');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(ProviderSnapshotRow, entity => {
            entity.toTable('provider_snapshot_rows');
            entity.hasKey(row => row.id);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').hasConversion(tenantConverter)
                .isRequired();
            entity.property(row => row.label).hasColumnType('text')
                .hasConversion(labelConverter).isRequired();
            entity.tenantKey(row => row.tenantId);
        });
    }
}

function row(id: string): ProviderSnapshotRow {
    return Object.assign(new ProviderSnapshotRow(), { id, label: id });
}

function open(connection: RecordingDatabaseConnection): ProviderSnapshotContext {
    ProviderSnapshotContext.connection = connection;
    return ProviderSnapshotContext.create();
}

beforeEach(() => {
    providerEpoch = 'one';
    flipTenantAfterReturn = false;
    labelConversions = 0;
});

describe('bulk upsert provider-value snapshots', () => {
    it('uses one captured provider representation after an earlier batch awaits', async () => {
        const connection = new EpochChangingConnection();
        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rowCount: 1 });
        const db = open(connection);

        await expect(db.rows.upsert([row('a'), row('b')], {
            conflictProperties: ['id'],
            updateProperties: ['label'],
        })).resolves.toBe(2);

        expect(labelConversions).toBe(2);
        expect(connection.statements.map(statement => statement.values))
            .toEqual([
                ['a', 'tenant-one:one', 'a:one'],
                ['b', 'tenant-one:one', 'b:one'],
            ]);
    });

    it('fails before SQL when tenant validation and row capture diverge', async () => {
        const connection = new RecordingDatabaseConnection();
        const db = open(connection);
        flipTenantAfterReturn = true;

        await expect(db.rows.upsert([row('a')])).rejects.toThrow(
            'tenant key \'tenantId\' must match the current tenant scope',
        );

        expect(connection.statements).toEqual([]);
        expect(connection.transactionEvents).toEqual([]);
    });

    it('retains captured provider rows inside an explicit transaction', async () => {
        const connection = new EpochChangingConnection();
        connection.queueResult({ rowCount: 1 });
        connection.queueResult({ rowCount: 1 });
        const db = open(connection);

        await db.transaction(async tx => {
            await expect(tx.rows.upsert([row('a'), row('b')]))
                .resolves.toBe(2);
        });

        expect(connection.statements.map(statement => statement.values[2]))
            .toEqual(['a:one', 'b:one']);
        expect(connection.transactionEvents).toEqual([
            'begin', 'savepoint:entitykit_sp_1',
            'release:entitykit_sp_1', 'commit',
        ]);
    });
});
