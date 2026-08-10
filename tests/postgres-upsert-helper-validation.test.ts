import type { DbContextOptionsBuilder, ModelBuilder } from '../src';
import { DbContext } from '../src';
import {
    postgres,
    type PostgresUpsertOptions,
    type SqlStatement,
} from '../src/providers/postgres';
import { RecordingDatabaseConnection } from './support/recording-database-connection';

class ManagedPostgresRow {
    public id = '';
    public tenantId = 'tenant-one';
    public externalCode = '';
    public version = 0;
    public generatedValue = '';
    public label = '';
}

class PostgresHelperContext extends DbContext {
    public rows = this.set(ManagedPostgresRow);

    protected override configure(options: DbContextOptionsBuilder): void {
        options.useConnection(new RecordingDatabaseConnection())
            .useTenantScope(() => 'tenant-one');
    }

    protected override model(model: ModelBuilder): void {
        model.entity(ManagedPostgresRow, entity => {
            entity.toTable('managed_postgres_rows');
            entity.hasKey(row => row.id);
            entity.hasAlternateKey(row => row.externalCode);
            entity.property(row => row.id).hasColumnType('text').isRequired();
            entity.property(row => row.tenantId).hasColumnName('tenant_id')
                .hasColumnType('text').isRequired();
            entity.property(row => row.externalCode).hasColumnName('external_code')
                .hasColumnType('text').isRequired();
            entity.property(row => row.version).hasColumnType('integer')
                .isRequired().isVersion();
            entity.property(row => row.generatedValue)
                .hasColumnName('generated_value').hasColumnType('text')
                .valueGeneratedOnAddOrUpdate();
            entity.property(row => row.label).hasColumnType('text').isRequired();
            entity.tenantKey(row => row.tenantId);
        });
    }
}

function managedRow(): ManagedPostgresRow {
    return Object.assign(new ManagedPostgresRow(), {
        id: 'row-one',
        externalCode: 'external-one',
        label: 'one',
    });
}

describe('public Postgres upsert helper validation', () => {
    it('routes every immutable property role through shared validation', async () => {
        const db = PostgresHelperContext.create();
        const row = managedRow();
        const statement = (
            update: PostgresUpsertOptions<ManagedPostgresRow>,
        ): SqlStatement =>
            postgres.upsertStatement(db.rows, row, update);

        expect(() => statement({
            conflict: [item => item.externalCode],
            update: [item => item.id],
        })).toThrow('cannot include primary-key property \'ManagedPostgresRow.id\'');
        expect(() => statement({
            conflict: [item => item.externalCode],
            update: [item => item.tenantId],
        })).toThrow('cannot include tenant property \'ManagedPostgresRow.tenantId\'');
        expect(() => statement({
            conflict: [item => item.externalCode],
            update: [item => item.externalCode],
        })).toThrow('cannot include alternate-key property \'ManagedPostgresRow.externalCode\'');
        expect(() => statement({
            conflict: [item => item.externalCode],
            update: [item => item.version],
        })).toThrow('cannot include version property \'ManagedPostgresRow.version\'');
        expect(() => statement({
            conflict: [item => item.externalCode],
            update: [item => item.generatedValue],
        })).toThrow('cannot include store-generated property \'ManagedPostgresRow.generatedValue\'');

        expect(statement({
            conflict: [item => item.externalCode],
            update: [item => item.label],
        }).text).toContain('do update set "label" = excluded."label"');
        await db.dispose();
    });
});
